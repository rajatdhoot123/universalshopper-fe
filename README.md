# Universal Shopper Frontend

A ChatGPT-style UI for interacting with the automated shopping assistant.

## Features

- Chat interface for interacting with the automated shopping bot
- Support for the complete checkout flow:
  - Product URL processing
  - Login via OTP
  - Address selection
  - Payment processing
  - Bank OTP verification
- Real-time process status updates
- Natural language understanding for common requests

## Tech Stack

- Next.js
- React
- TypeScript
- TailwindCSS

## Prerequisites

- Node.js 18+ 
- Backend API server running (see the FastAPI backend repository)

## Setup

1. Clone the repository:
   ```
   git clone https://github.com/your-username/universalshopper-fe.git
   cd universalshopper-fe
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env.local` file in the project root:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```
   
   Adjust the URL to match your backend API server.

4. Start the development server:
   ```
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Open the application in your browser
2. Type or paste a product URL from Flipkart to start the shopping process
3. Follow the assistant's instructions to complete the checkout
4. The assistant will guide you through:
   - Login (via OTP)
   - Address selection
   - Payment details
   - Bank OTP verification

## Commands

- `help` - Get a list of available commands
- `status` - Check the status of your current shopping process
- `cancel` - Cancel the current shopping process

## Development

- `npm run dev` - Start the development server
- `npm run build` - Build for production
- `npm run start` - Start the production server
- `npm run lint` - Run ESLint

## Environment Variables

- `NEXT_PUBLIC_API_URL` - Backend API URL (default: http://localhost:8000)

## Description

This is the frontend application for the Universal Shopper project. It provides a user interface to interact with the [Universal Shopper Backend API](https://github.com/rajatdhoot123/UniversalShopper) for automating purchases on supported e-commerce websites.

## License

MIT
# universalshopper-fe
