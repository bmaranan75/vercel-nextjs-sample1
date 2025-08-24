# Next.js OpenAI Chat App with Weather Tool

A simple chat application built with Next.js 15 and OpenAI API with weather tool functionality that can be deployed to Vercel.

## Features

- 🤖 Real-time chat with OpenAI GPT-4o Mini
- 🌤️ Weather tool integration using OpenAI function calling
- 🔐 Auth0 authentication integration
- 📱 Responsive design with Tailwind CSS
- ⚡ Streaming responses for better UX
- 🚀 Ready for Vercel deployment
- 💨 Built with Next.js 15 and TypeScript

## Setup

1. **Clone the repository:**
```bash
git clone <your-repo-url>
cd vercel-nextjs-sample1
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
Create a `.env.local` file in the root directory and add your OpenAI API key:
```
OPENAI_API_KEY=your_openai_api_key_here
```

4. **Run the development server:**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## Deploy to Vercel

### Option 1: One-click Deploy
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/vercel-nextjs-sample1)

### Option 2: Manual Deploy
1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add the `OPENAI_API_KEY` environment variable in Vercel dashboard:
   - Go to your project settings
   - Navigate to "Environment Variables"
   - Add `OPENAI_API_KEY` with your OpenAI API key
4. Deploy!

## Usage

1. Type your message in the input field
2. Press "Send" or hit Enter
3. Watch as the AI responds with streaming text
4. Continue the conversation naturally

## Tech Stack

- **Framework:** Next.js 15 with App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **AI:** OpenAI GPT-3.5 Turbo API
- **Deployment:** Vercel

## API Routes

- `POST /api/chat` - Handles chat messages and streams responses from OpenAI

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | Your OpenAI API key | Yes |

## License

MIT
