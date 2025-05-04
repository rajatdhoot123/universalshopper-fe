// API Service for the Universal Shopper

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface ProductInfo {
  name: string;
  price: string;
  image_url?: string;
  details?: Record<string, string>;
}

export interface Address {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  isSelected?: boolean;
}

export interface Process {
  process_id: string;
  status: string;
  stage: string;
  product_url?: string;
  product_info?: ProductInfo;
  timestamp?: string;
  session_name?: string;
  message?: string;
  addresses?: Address[];
  screenshot_url?: string;
  data?: {
    product_url?: string;
    available_addresses?: Array<{ index: number; name: string; text: string }>;
    address_index?: number;
    total_amount?: string;
    expiry_input_type?: string;
    payment_details_provided?: boolean;
    is_new_expiry_format?: boolean;
  };
}

export interface ApiResponse<T = Record<string, unknown>> {
  status: string;
  message: string;
  data: T;
}

// Fetch helper with error handling
async function fetchWithErrorHandling<T = Record<string, unknown>>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'An error occurred');
    }

    return data as ApiResponse<T>;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Session management
export const listSessions = async (): Promise<string[]> => {
  const response = await fetchWithErrorHandling<{sessions: string[]}>(`${API_BASE_URL}/sessions`);
  return response.data.sessions;
};

// Process management
export const startProcess = async (productUrl: string, sessionName?: string, useExistingSession: boolean = false): Promise<Process> => {
  const response = await fetchWithErrorHandling<Process>(`${API_BASE_URL}/process`, {
    method: 'POST',
    body: JSON.stringify({
      product_url: productUrl,
      session_name: sessionName,
      use_existing_session: useExistingSession,
    }),
  });
  
  return response.data;
};

export const getProcess = async (processId: string): Promise<Process> => {
  const response = await fetchWithErrorHandling<Process>(`${API_BASE_URL}/process/${processId}`);
  return response.data;
};

export const listProcesses = async (): Promise<Process[]> => {
  const response = await fetchWithErrorHandling<{processes: Process[]}>(`${API_BASE_URL}/processes`);
  return response.data.processes;
};

// Login and Authentication
export const submitLoginOTP = async (processId: string, otp: string): Promise<void> => {
  await fetchWithErrorHandling(`${API_BASE_URL}/process/${processId}/login-otp`, {
    method: 'POST',
    body: JSON.stringify({ process_id: processId, otp }),
  });
};

// Address selection
export const selectAddress = async (processId: string, addressIndex: number): Promise<void> => {
  await fetchWithErrorHandling(`${API_BASE_URL}/process/${processId}/select-address`, {
    method: 'POST',
    body: JSON.stringify({ process_id: processId, address_index: addressIndex }),
  });
};

// Payment processing
export const submitPaymentDetails = async (
  processId: string,
  cardNumber: string,
  cvv: string,
  expiryMonth?: string,
  expiryYear?: string,
  expiryCombined?: string,
): Promise<void> => {
  await fetchWithErrorHandling(`${API_BASE_URL}/process/${processId}/payment`, {
    method: 'POST',
    body: JSON.stringify({
      process_id: processId,
      card_number: cardNumber,
      cvv,
      expiry_month: expiryMonth,
      expiry_year: expiryYear,
      expiry_combined: expiryCombined,
    }),
  });
};

export const submitBankOTP = async (processId: string, otp: string): Promise<void> => {
  await fetchWithErrorHandling(`${API_BASE_URL}/process/${processId}/bank-otp`, {
    method: 'POST',
    body: JSON.stringify({ process_id: processId, otp }),
  });
};

// Function to submit phone number for login
export async function submitPhoneNumber(processId: string, phoneNumber: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/process/${processId}/phone_number`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to submit phone number: ${errorText}`);
  }
} 