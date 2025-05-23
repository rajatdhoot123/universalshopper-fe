"use client"
import { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '../services/api';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Define the structure of the address coming from the API
interface ApiAddress {
  index: number;
  name: string;
  text: string;
}

// Define specific types for required input to improve type safety
type RequiredInputType = 'login_otp' | 'select_address' | 'payment' | 'bank_otp' | 'create_session' | 'phone_number' | null;

interface ActionData {
  addresses?: ApiAddress[]; // Use the new address type
  is_new_expiry_format?: boolean; // Add flag for expiry format
  // Add other potential data fields needed for prompts if necessary
}

// Constants
const POLLING_INTERVAL_MS = 3000; // 3 seconds
const MAX_POLLS = 100; // Timeout after 100 polls (100 * 3s = 5 minutes)

export default function ShoppingChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeProcess, setActiveProcess] = useState<api.Process | null>(null);
  // State for session selection/creation phase
  const [sessionState, setSessionState] = useState<'selecting' | 'url_required'>('selecting');
  const [currentSession, setCurrentSession] = useState<{ name: string; isExisting: boolean } | null>(null);
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  // State for required input during an active process
  const [requiredInputType, setRequiredInputType] = useState<RequiredInputType>(null);
  const [requiredInputData, setRequiredInputData] = useState<ActionData | null>(null);

  // Use useRef for interval ID and poll count
  const [intervalIdRef, pollCountRef, messagesEndRef, inputRef] = [
    useRef<NodeJS.Timeout | null>(null),
    useRef(0),
    useRef<HTMLDivElement>(null),  // For scrolling
    useRef<HTMLInputElement>(null)  // For input focus
  ];

  // Function to STOP polling
  const stopPolling = useCallback(() => {
    if (intervalIdRef.current) {
      console.log(`[Polling Control] Stopping polling. Interval ID: ${intervalIdRef.current}`);
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
      pollCountRef.current = 0; // Reset count
    }
  }, []);

  // Function to display session options as a chat message
  const displaySessionOptions = useCallback(() => {
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: 'Click on existing session'
    }]);
  }, []);

  // Function to RESET component state after process ends/fails/cancels
  const resetToSessionSelection = useCallback(async () => {
    console.log("[State Reset] Resetting to session selection.");
    stopPolling();
    setActiveProcess(null);
    setRequiredInputType(null);
    setRequiredInputData(null);
    setCurrentSession(null);
    setSessionState('selecting');
    setIsLoading(true);
    try {
      const sessions = await api.listSessions();
      setAvailableSessions(sessions);
      // Add a message prompting for session selection again
       const resetMessage = "Process finished or stopped.\n\nSelect/create session.";
       setMessages(prev => [...prev, { role: 'system', content: resetMessage }]);
       
       // Display session options after reset
       displaySessionOptions();
    } catch (fetchError) {
      console.error("Error fetching sessions post-reset:", fetchError);
       setMessages(prev => [...prev, { role: 'system', content: "Process finished. Error fetching sessions. Try 'create <name>'." }]);
    } finally {
        setIsLoading(false);
    }
  }, [stopPolling, displaySessionOptions]); // Added displaySessionOptions as dependency

  // Function to START polling (if not already running)
  const startPolling = useCallback((processId: string) => {
    if (intervalIdRef.current) {
      // console.log('[Polling Control] Already polling. Ignoring start request.');
      return; // Already polling
    }
    stopPolling(); // Clear any potential lingering interval first
    console.log(`[Polling Control] Starting polling for process ${processId}...`);
    pollCountRef.current = 0;
    setRequiredInputType(null); // Ensure no input is marked as required when polling starts/resumes
    setIsLoading(true); // Indicate loading when polling starts

    intervalIdRef.current = setInterval(async () => {
      pollCountRef.current += 1;

      // --- Timeout Check ---
      if (pollCountRef.current > MAX_POLLS) {
        console.warn(`Polling timeout reached for process ${processId}`);
        setMessages(prev => [...prev, { role: 'assistant', content: 'Process timed out. Resetting.' }]);
        await resetToSessionSelection(); // Use the reset function
        setIsLoading(false); // Stop loading indicator on timeout/reset
        return;
      }

      // --- API Call ---
      try {
        const updatedProcess = await api.getProcess(processId);
        const previousStage = activeProcess?.stage; // Get previous stage *before* updating state


        console.log("updatedProcess", updatedProcess);
        // --- Update Process State ---
        // Store the latest process state, regardless of stage change,
        // to have the most up-to-date message, status, screenshot etc.
        // Use functional update to merge and preserve existing fields like process_id
        setActiveProcess(prev => ({ ...prev, ...updatedProcess }));


        // --- Stage Change Detection & Handling (based on updatedProcess) ---
        // Only react significantly if the stage *actually changes*
        if (updatedProcess.stage !== previousStage) {
            console.log(`Polling - Stage changed! From: ${previousStage || 'N/A'}, To: ${updatedProcess.stage}`);
            let message = updatedProcess.message || ''; // Use message from API if available
            let nextRequiredInput: RequiredInputType = null;
            let nextInputData: ActionData | null = null;
            let shouldStopPolling = false;
            let shouldReset = false;

            // --- Stages Requiring USER INPUT ---
            // Safely access stage using optional chaining
            const currentStage = updatedProcess.stage;
            switch (currentStage) {
                case 'LOGIN_REQUIRED':
                    message = message || 'Please enter your phone number.';
                    nextRequiredInput = 'phone_number';
                    shouldStopPolling = true;
                    break;
                case 'login_otp_required':
                case 'OTP_REQUESTED': // Handle new stage similarly
                    message = message || 'Please enter login OTP.';
                    nextRequiredInput = 'login_otp';
                    shouldStopPolling = true;
                    break;
                case 'SELECTING_ADDRESS':
                    message = message || 'Please select delivery address:';
                    // Safely access nested addresses using the correct ApiAddress type
                    const availableAddresses: ApiAddress[] | undefined =
                        updatedProcess.data?.available_addresses;

                    if (availableAddresses && Array.isArray(availableAddresses) && availableAddresses.length > 0) {
                        // Check if it's actually an array before iterating
                        availableAddresses.forEach((addr: ApiAddress) => {
                            // Basic check for expected fields inside the loop
                            if (addr && typeof addr.index === 'number' && addr.name && addr.text) {
                                message += `\n${addr.index + 1}. ${addr.name}: ${addr.text}`;
                            } else {
                                console.warn('Skipping invalid address object:', addr);
                            }
                        });
                        message += '\nEnter number.';
                        nextInputData = { addresses: availableAddresses };
                    } else {
                        message += '\n(No addresses found or invalid format)';
                    }
                    nextRequiredInput = 'select_address';
                    shouldStopPolling = true;
                    break;
                case 'PAYMENT_REQUESTED':
                    // Use API message or a default, potentially add total amount
                    const paymentMessage = updatedProcess.message || 'Please provide payment details.';
                    const totalAmount = updatedProcess.data?.total_amount;
                    message = totalAmount ? `${paymentMessage} Total: ${totalAmount}` : paymentMessage;
                    // Store is_new_expiry_format if needed later for validation/placeholder
                    nextInputData = { is_new_expiry_format: updatedProcess.data?.is_new_expiry_format };
                    nextRequiredInput = 'payment';
                    shouldStopPolling = true;
                    break;
                case 'BANK_OTP_REQUESTED':
                    message = message || 'Enter bank OTP.';
                    nextRequiredInput = 'bank_otp';
                    shouldStopPolling = true;
                    break;
                // --- TERMINAL States ---
                case 'completed':
                    message = message || 'Order placed successfully!';
                    shouldStopPolling = true;
                    shouldReset = true;
                    break;
                case 'failed':
                    message = `Process failed: ${message || 'Unknown error'}`;
                    shouldStopPolling = true;
                    shouldReset = true;
                    break;
                // Add 'cancelled' if your API supports it explicitly
                // case 'cancelled':
                //    message = message || 'Process cancelled.';
                //    shouldStopPolling = true;
                //    shouldReset = true;
                //    break;

                // --- Intermediate states ---
                 default:
                    // If API provides a message for an intermediate state, show it
                    if (message) {
                         console.log(`Polling - Intermediate state ${updatedProcess.stage} with message: ${message}`);
                    } else {
                    // Optionally add a generic "Processing..." message if needed,
                    // but often just updating the header status is enough.
                    // message = `Processing: ${updatedProcess.stage}...`;
                    }
                    // Continue polling for intermediate states
                    break;
            }

             // --- Update UI & State Machine ---
             if (message) {
                 setMessages(prev => [...prev, { role: 'assistant', content: message }]);
             }

             // Update required input state and data
             if (shouldStopPolling) {
                console.log(`Polling - Setting required input to: ${nextRequiredInput}`);
                setRequiredInputType(nextRequiredInput);
                setRequiredInputData(nextInputData); // Store data needed for the prompt/input
                stopPolling(); // Stop interval *after* setting state
                setIsLoading(false); // Stop loading indicator when input is required or process ends
                if (shouldReset) {
                    await resetToSessionSelection(); // Reset fully
                }
             } else {
                // If it's an intermediate state change but polling continues, keep loading indicator active
                setIsLoading(true);
             }
        } else {
            // Stage didn't change, but polling continues. Keep loading indicator active.
             setIsLoading(true);
        }

        // --- Handle Screenshot URL Update (If stage didn't change but screenshot did) ---
         // This case is mostly handled by the general setActiveProcess(updatedProcess) above.
         // We only need to add a message if the URL changes *and* the stage didn't trigger a message already.
        if (updatedProcess.stage === previousStage && updatedProcess.screenshot_url && updatedProcess.screenshot_url !== activeProcess?.screenshot_url) {
             // setActiveProcess(updatedProcess); // Already done above
            setMessages(prev => [...prev, { role: 'assistant', content: `Status update: ${updatedProcess.screenshot_url}` }]);
        }

      // --- API Error Handling ---
      } catch (error) {
        console.error('Polling API Error:', error);
        let errorMsg = 'Error checking status.';
        // Basic 404 check
        if (error instanceof Error && error.message.includes('404')) {
            errorMsg = 'Process not found or may have expired.';
        }
        setMessages(prev => [...prev, { role: 'assistant', content: errorMsg + ' Resetting.' }]);
        await resetToSessionSelection(); // Use the reset function
        setIsLoading(false); // Stop loading on API error
      }
    }, POLLING_INTERVAL_MS);
  // Dependencies: Only include stable functions needed by the callback.
  // The callback itself will access the latest state when it runs.
  }, [stopPolling, resetToSessionSelection]);


  // Effect to manage polling lifecycle based ONLY on activeProcess existence
  useEffect(() => {
    if (activeProcess?.process_id && requiredInputType === null) {
      // Start polling only if a process is active AND no input is currently required.
      console.log(`[Polling Lifecycle] Process active (${activeProcess.process_id}) and no input required. Ensuring polling is started.`);
      startPolling(activeProcess.process_id);
    } else if (!activeProcess?.process_id) {
        // Ensure polling is stopped if process becomes inactive
        console.log("[Polling Lifecycle] No active process. Ensuring polling is stopped.");
        stopPolling();
        setIsLoading(false); // Ensure loading stops if process becomes null unexpectedly
    } else {
        // If process is active but input *is* required, ensure polling *remains* stopped.
        console.log(`[Polling Lifecycle] Process active (${activeProcess.process_id}) but waiting for input (${requiredInputType}). Polling should be stopped.`);
        stopPolling(); // Explicitly call stop here too for robustness
        setIsLoading(false); // Ensure loading stops when waiting for input
    }

    // Cleanup function ensures polling stops on unmount or if activeProcess becomes null
    return () => {
      console.log("[Polling Lifecycle Cleanup] Component unmounting or activeProcess changed. Stopping polling.");
      stopPolling();
    };
  // Re-run ONLY when the process ID appears/disappears, or when input requirement changes.
  }, [activeProcess?.process_id, requiredInputType, startPolling, stopPolling]);


  // Initial setup: Fetch sessions and display welcome message
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      setSessionState('selecting'); // Ensure initial state
      try {
        console.log("[Initial Load] Fetching sessions...");
        const sessions = await api.listSessions();
        console.log("[Initial Load] Received sessions:", sessions);
        setAvailableSessions(sessions);

        setMessages([{ role: 'system', content: "Welcome to Universal Shopper! Please choose an option:" }]);
        
        // Immediately display session selection options in chat style
        if (sessions.length > 0) {
          displaySessionOptions();
        }
      } catch (error) {
        console.error('[Initial Load] Error fetching sessions:', error);
        setMessages([{
          role: 'system',
          content: "Welcome! Error fetching sessions. Try creating a new session."
        }]);
      } finally {
        console.log("[Initial Load] Fetch finished.");
        setIsLoading(false);
      }
    };
    console.log("[Initial Load] Running useEffect for initial data fetch.");
    fetchInitialData();
    // Intentionally empty dependency array to run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle select session
  const handleSelectSession = (session: string) => {
    setMessages(prev => [...prev, { role: 'assistant', content: `Using session '${session}'. Please paste the product URL.` }]);
    setCurrentSession({ name: session, isExisting: true });
    setSessionState('url_required');
  };

  // Handle create new session button click
  const handleCreateNewClick = () => {
    setRequiredInputType('create_session');
    setMessages(prev => [...prev, { role: 'assistant', content: "Please enter a name for your new session:" }]);
  };

  // --- handleSendMessage ---
  const handleSendMessage = async (e: React.FormEvent) => {
     e.preventDefault();
     // Allow sending even if isLoading is true, but only if requiredInputType is set
     // This allows submitting OTP etc. even if the UI shows a spinner from the previous poll cycle
     if (!input.trim() || (isLoading && !requiredInputType)) return;

     const userInput = input.trim();
     const userMessage: Message = { role: 'user', content: userInput };
     setMessages(prev => [...prev, userMessage]);
     setInput('');
     // Set loading true immediately upon user sending a message,
     // especially when submitting required input.
     setIsLoading(true);

     try {
        // --- 1. Handle Input Required by Active Process FIRST ---
        if (activeProcess && requiredInputType) {
            const processId = activeProcess.process_id;
            let submissionSuccessful = false;

            // --- Submit based on requiredInputType ---
            try {
                 switch (requiredInputType) {
                     case 'phone_number':
                         // Simple validation for phone number
                         const phoneRegex = /^\d{10}$/;  // Basic validation for 10-digit phone
                         if (phoneRegex.test(userInput.replace(/\D/g, ''))) {
                             await api.submitPhoneNumber(processId, userInput.replace(/\D/g, ''));
                             setMessages(prev => [...prev, { role: 'assistant', content: 'Phone number submitted. Checking status...' }]);
                             submissionSuccessful = true;
                         } else {
                             setMessages(prev => [...prev, { role: 'assistant', content: 'Please enter a valid 10-digit phone number.' }]);
                             setIsLoading(false); // Stop loading on validation error
                         }
                         break;
                     case 'login_otp':
                         await api.submitLoginOTP(processId, userInput);
                         setMessages(prev => [...prev, { role: 'assistant', content: 'Login OTP submitted. Checking status...' }]);
                         submissionSuccessful = true;
                         break;
                     case 'select_address':
                         const idx = parseInt(userInput, 10) - 1;
                         const addresses = requiredInputData?.addresses;
                         if (!isNaN(idx) && idx >= 0 && addresses && idx < addresses.length) {
                             await api.selectAddress(processId, idx);
                             setMessages(prev => [...prev, { role: 'assistant', content: `Selected address: ${addresses[idx].name}. Checking status...` }]);
                             submissionSuccessful = true;
                         } else {
                             setMessages(prev => [...prev, { role: 'assistant', content: 'Invalid selection. Please enter a valid number from the list.' }]);
                             setIsLoading(false); // Stop loading on validation error
                         }
                         break;
                     case 'payment':
                         const details = userInput.split(',').map(s => s.trim());
                         if (details.length === 3) {
                             const [num, cvv, exp] = details;
                             const expParts = exp.split('/');
                             if (expParts.length === 2 && /^\d{2}$/.test(expParts[0]) && /^\d{2}$/.test(expParts[1])) {
                                 await api.submitPaymentDetails(processId, num, cvv, expParts[0], expParts[1], exp);
                                 setMessages(prev => [...prev, { role: 'assistant', content: 'Payment details submitted. Checking status...' }]);
                                 submissionSuccessful = true;
                             } else {
                                setMessages(prev => [...prev, { role: 'assistant', content: 'Invalid expiry format. Please use MM/YY (e.g., 05/28).' }]);
                                setIsLoading(false); // Stop loading on validation error
                             }
                         } else {
                             setMessages(prev => [...prev, { role: 'assistant', content: 'Invalid format. Please enter Number, CVV, MM/YY separated by commas.' }]);
                             setIsLoading(false); // Stop loading on validation error
                         }
                         break;
                     case 'bank_otp':
                         await api.submitBankOTP(processId, userInput);
                         setMessages(prev => [...prev, { role: 'assistant', content: 'Bank OTP submitted. Checking status...' }]);
                         submissionSuccessful = true;
                         break;
                 }
            } catch (submitError) {
                 console.error(`Error submitting ${requiredInputType}:`, submitError);
                 let errorMsg = `Error submitting ${requiredInputType}.`;
                 if (submitError instanceof Error) errorMsg += ` ${submitError.message}`;
                 setMessages(prev => [...prev, { role: 'assistant', content: errorMsg + ' Please try again.' }]);
                 setIsLoading(false);
                 return; // Exit handleSendMessage early on submit error
            }

            if (submissionSuccessful) {
                setRequiredInputType(null);
                setRequiredInputData(null);
                startPolling(processId);
            }
        }
        // Handle create session input
        else if (requiredInputType === 'create_session') {
            if(userInput.trim()) {
                setMessages(prev => [...prev, { role: 'assistant', content: `Creating new session '${userInput}'. Please paste the product URL.` }]);
                setCurrentSession({ name: userInput, isExisting: false });
                setSessionState('url_required');
                setRequiredInputType(null);
                setIsLoading(false);
            } else {
                setMessages(prev => [...prev, { role: 'assistant', content: 'Please enter a valid session name.' }]);
                setIsLoading(false);
            }
        }
        // --- 2. Handle Session Setup / URL Input (Only if no required input) ---
        else if (sessionState === 'selecting' || sessionState === 'url_required') {
            if (sessionState === 'selecting') {
                let sessionToUse: string | null = null;
                let createNew = false;
                const command = userInput.toLowerCase().split(' ')[0];
                const value = userInput.substring(command.length).trim();

                if (command === 'select' && value) {
                  const index = parseInt(value, 10) - 1;
                  if (!isNaN(index) && index >= 0 && index < availableSessions.length) {
                      sessionToUse = availableSessions[index];
                  } else if (availableSessions.includes(value)) {
                      sessionToUse = value;
                  }
                } else if (command === 'create' && value) {
                    sessionToUse = value;
                    createNew = true;
                }

                if (sessionToUse) {
                    const message = createNew ? `Creating new session '${sessionToUse}'. Please paste the product URL.` : `Using session '${sessionToUse}'. Please paste the product URL.`;
                    setMessages(prev => [...prev, { role: 'assistant', content: message }]);
                    setCurrentSession({ name: sessionToUse, isExisting: !createNew });
                    setSessionState('url_required');
                    setIsLoading(false);
                } else {
                    setMessages(prev => [...prev, { role: 'assistant', content: "Invalid command. Use 'select <number or name>' or 'create <name>'." }]);
                    setIsLoading(false);
                }
            } else { // sessionState === 'url_required'
                 const urlRegex = /(https?:\/\/[^\s]+)/g;
                 const urls = userInput.match(urlRegex);
                 if (urls && urls.length > 0 && currentSession) {
                     const productUrl = urls[0];
                     setMessages(prev => [...prev, { role: 'assistant', content: `Got it! Starting checkout for ${productUrl} in session '${currentSession.name}'.` }]);
                     const process = await api.startProcess(productUrl, currentSession.name, currentSession.isExisting);
                     setMessages(prev => [...prev, { role: 'assistant', content: `Process ${process.process_id} initiated. I'll keep you updated.` }]);
                     setActiveProcess(process);
                     setSessionState('selecting'); // Reset session state machine
                 } else {
                     setMessages(prev => [...prev, { role: 'assistant', content: 'Please paste a valid product URL.' }]);
                     setIsLoading(false);
                 }
            }
        }
        // --- 3. Handle General Messages During Active Process (No Specific Input Required) ---
        else if (activeProcess && !requiredInputType) {
             let assistantResponse = '';
             const command = userInput.toLowerCase();
             if (command.includes('cancel')) {
                 // await api.cancelProcess(activeProcess.process_id);
                 setMessages(prev => [...prev, { role: 'assistant', content: "Okay, stopping the current process." }]);
                 await resetToSessionSelection();
             } else if (command.includes('status')) {
                 assistantResponse = `Current status: ${activeProcess.status} (${activeProcess.stage}). ${activeProcess.message || ''}`;
                 if(activeProcess.screenshot_url) assistantResponse += `\nLast screenshot: ${activeProcess.screenshot_url}`;
                 setMessages(prev => [...prev, { role: 'assistant', content: assistantResponse }]);
                 setIsLoading(false); // Status request doesn't require further loading
             } else if (command.includes('help')) {
                 assistantResponse = "While processing, you can ask for 'status' or tell me to 'cancel'.";
                 setMessages(prev => [...prev, { role: 'assistant', content: assistantResponse }]);
                 setIsLoading(false); // Help request doesn't require further loading
             } else {
                 // Don't add a message here. The header shows the status,
                 // and the loading indicator shows activity.
             }
        }
        // --- 4. Fallback ---
        else {
             console.warn("handleSendMessage reached unexpected state:", { activeProcess, requiredInputType, sessionState });
             setMessages(prev => [...prev, { role: 'assistant', content: 'I seem to be in an unexpected state. Please try refreshing or starting a new session.' }]);
             await resetToSessionSelection();
        }

     } catch (error: unknown) { // Catch errors from session/URL handling or unexpected issues
         console.error('Error in handleSendMessage:', error);
         let errorMsg = "An unexpected error occurred.";
         if (error instanceof Error) errorMsg += ` ${error.message}`;
         setMessages(prev => [...prev, { role: 'assistant', content: errorMsg + ' Please try again or refresh.' }]);
          // Consider resetting state on major errors
          // await resetToSessionSelection();
         setIsLoading(false); // Ensure loading stops on unexpected errors
     }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto focus input when requiredInputType changes to non-null
  useEffect(() => {
    if (requiredInputType !== null && inputRef.current) {
      // Focus the input field when input is required
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100); // Small delay to ensure UI has updated
    }
  }, [requiredInputType]);

  // Placeholder text logic based on the new state structure
  const getPlaceholderText = () => {
     // Prioritize required input prompts
     switch (requiredInputType) {
        case 'login_otp':
            return "Enter login OTP...";
        case 'select_address':
            return "Enter address number...";
        case 'payment':
            // Use the expected format based on common practice / API hints
            return "Enter Card Number, CVV, MM/YY...";
        case 'bank_otp':
            return "Enter bank OTP...";
        case 'create_session':
            return "Enter a name for your session...";
        case 'phone_number':
            return "Enter your phone number...";
        // case null: continue to check sessionState or activeProcess...
     }

     // If no specific input required, check session state
     switch (sessionState) {
        case 'selecting':
            return availableSessions.length > 0
                ? "Type 'select <num/name>' or 'create <name>'..."
                : "Type 'create <session_name>'...";
        case 'url_required':
            return `Paste product URL for session '${currentSession?.name}'...`;
     }

     // If process is active and no input needed
     if (activeProcess) {
         return isLoading ? "Processing..." : "Processing... Type 'status' or 'cancel'.";
     }

     // Default/fallback after reset or initial load
     return "Select or create a session to begin.";
  };

  // --- Render JSX ---
  return (
    <div className="flex flex-col h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 py-3 px-4 sticky top-0 z-10 border-b border-slate-700">
        <h1 className="text-xl font-bold text-white">Universal Shopper</h1>
        {/* Display Process Info Conditionally */}
        {activeProcess && (
          <div className="text-xs text-slate-400 mt-1">
            <span className="font-medium text-slate-300">Process:</span> <span className="font-mono">{activeProcess.process_id}</span> | 
            <span className="font-medium text-slate-300"> Session:</span> <span>{currentSession?.name || 'N/A'}</span> | 
            <span className="font-medium text-slate-300"> Status:</span> <span>{activeProcess.status}</span> | 
            <span className="font-medium text-slate-300"> Stage:</span> <span className="font-mono">{activeProcess.stage}</span>
            {activeProcess.message && <span className="italic text-slate-400"> ({activeProcess.message})</span>}
          </div>
        )}
        {/* Display Session Info Before Process Starts */}
        {!activeProcess && currentSession && sessionState === 'url_required' && (
          <div className="text-xs text-slate-400 mt-1">
            <span className="font-medium text-slate-300">Session:</span> <span>{currentSession.name}</span> (Waiting for URL)
          </div>
        )}
      </header>

      {/* Chat container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-900">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {message.role === "user" && (
              <div className="max-w-[85%] rounded-2xl bg-indigo-600 p-3 shadow-sm">
                <div className="flex items-center">
                  <div className="flex-grow whitespace-pre-wrap text-white font-medium break-words overflow-hidden">
                    {message.content}
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    <Avatar className="h-8 w-8 bg-indigo-700 flex items-center justify-center text-white border border-indigo-500">
                      <span className="text-xs font-medium">You</span>
                    </Avatar>
                  </div>
                </div>
              </div>
            )}
            {message.role !== "user" && (
              <div className={`max-w-[85%] rounded-2xl p-3 shadow-sm ${
                message.role === "system" ? "bg-slate-800" : "bg-slate-800"
              }`}>
                <div className="flex text-slate-200">
                  <Avatar className="h-8 w-8 mr-3 flex-shrink-0 bg-slate-700 flex items-center justify-center text-slate-200 border border-slate-600">
                    <span className="text-xs font-medium">AI</span>
                  </Avatar>
                  <div className="whitespace-pre-wrap break-words overflow-hidden w-full">
                    {typeof message.content === 'string' && message.content.startsWith('http') ? (
                      <a 
                        href={message.content} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-white font-medium underline hover:text-slate-200 break-all overflow-hidden"
                      >
                        {/* Display shortened version of URL */}
                        {message.content.length > 50 
                          ? `${message.content.substring(0, 40)}...${message.content.substring(message.content.lastIndexOf("/"))}` 
                          : message.content}
                      </a>
                    ) : (
                      message.content
                    )}
                    
                    {/* Session buttons inside chat message */}
                    {message.content === 'Click on existing session' && (
                      <div className="mt-4 space-y-3">
                        {availableSessions.map((session, idx) => (
                          <Button
                            key={idx}
                            onClick={() => handleSelectSession(session)}
                            variant="outline"
                            className="w-full py-3 justify-center bg-slate-700 border-slate-600 hover:bg-slate-600 text-white rounded-md cursor-pointer"
                          >
                            {session}
                          </Button>
                        ))}
                        
                        <div className="flex items-center my-4">
                          <div className="flex-grow h-px bg-slate-700"></div>
                          <div className="mx-4 text-slate-400 text-sm">OR</div>
                          <div className="flex-grow h-px bg-slate-700"></div>
                        </div>
                        
                        <Button
                          onClick={handleCreateNewClick}
                          className="w-full py-3 justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-md cursor-pointer  "
                        >
                          Create new
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
         
        {/* Loading indicator */}
        {isLoading && requiredInputType === null && (
          <div className="flex justify-start">
            <div className="max-w-[85%] bg-slate-800 rounded-2xl p-3 shadow-sm">
              <div className="flex space-x-1 items-center text-sm text-slate-400">
                <span>Processing</span>
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }}></div>
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }}></div>
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} /> {/* Element to scroll to */}
      </div>

      {/* Input area */}
      <div className="border-t border-slate-700 bg-slate-800 p-3 sticky bottom-0">
        <form onSubmit={handleSendMessage} className="flex space-x-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={getPlaceholderText()}
            className="flex-1 rounded-full bg-slate-700 border-slate-600 text-white placeholder:text-slate-400 focus-visible:ring-indigo-500"
            disabled={isLoading && requiredInputType === null}
          />
          <Button
            type="submit"
            disabled={!input.trim() || (isLoading && requiredInputType === null)}
            className="rounded-full bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}

// Add basic CSS for animation (e.g., in globals.css or using styled-jsx)
/*
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.animate-fade-in-up {
  animation: fadeInUp 0.3s ease-out forwards;
}
*/ 