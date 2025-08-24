# Enhanced Google Calendar Integration

## ✅ **New Features - Click-to-Grant Authorization**

The Google Calendar integration has been enhanced with a seamless in-chat authorization experience:

### **What's New:**
- **In-Chat Authorization Button**: Users can now grant Google Calendar access directly from the chat interface
- **Popup OAuth Flow**: Authorization opens in a secure popup window
- **Real-time Feedback**: Users receive immediate success/error messages in the chat
- **Improved UX**: No need to manually navigate to authorization URLs

## Required Setup Steps

To enable Google Calendar functionality in your chat application, you need to:

### 1. Create Google Cloud Project & Enable Calendar API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Calendar API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

### 2. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Configure the OAuth consent screen if prompted
4. Choose "Web application" as the application type
5. Set the authorized redirect URI to: `http://localhost:3000/api/auth/google/callback`
6. Save and copy the Client ID and Client Secret

### 3. Update Environment Variables

Update your `.env.local` file with the actual values:

```bash
GOOGLE_CLIENT_ID=your_actual_google_client_id
GOOGLE_CLIENT_SECRET=your_actual_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

## **Enhanced User Experience**

### **How It Works:**

1. **User asks about calendar** → "What's on my calendar today?"
2. **If not authorized** → Chat displays authorization message with blue "Grant Google Calendar Access" button
3. **User clicks button** → Secure popup window opens with Google OAuth flow
4. **User authorizes** → Popup closes automatically, chat shows success message
5. **Future requests** → System fetches live calendar data instantly

### **Interactive Features:**

- ✅ **One-Click Authorization**: Beautiful blue button with Google icon
- ✅ **Popup OAuth Flow**: Secure, user-friendly popup window
- ✅ **Auto-Close Windows**: Popup closes automatically after authorization
- ✅ **Real-time Updates**: Immediate feedback in chat
- ✅ **Error Handling**: Clear error messages for denied/failed authorization
- ✅ **Visual Feedback**: Success/error icons and messages

### **Security Features:**

- ✅ **Always requires consent** (`prompt: 'consent'`)
- ✅ **Auth0 integration** - Only authenticated users can access
- ✅ **Read-only permissions** - Only calendar viewing, no modifications
- ✅ **Scoped access** - Limited to calendar.readonly scope
- ✅ **Secure token handling** - Server-side only token management
- ✅ **Popup security** - OAuth flow contained in secure popup

## Usage Examples

Users can now ask:
- "What's on my calendar today?"
- "Show me my schedule for this week"
- "Do I have any meetings tomorrow?"
- "What events do I have coming up?"

**When first asked, users will see:**
```
🔐 Google Calendar Authorization Required

To view your calendar events, I need permission to access your Google Calendar.

[Grant Google Calendar Access] <- Blue button with Google icon

After authorization, please ask me about your calendar again.
```

**After clicking the button:**
- Popup opens with Google OAuth
- User grants permission
- Popup closes automatically
- Chat shows: "✅ Google Calendar access granted successfully!"

## Technical Implementation

### **New Components:**
- **Enhanced Chat UI**: Detects authorization requirements and renders buttons
- **Popup OAuth Handler**: Opens secure popup for Google authorization
- **Auth Success Page**: Communicates with parent window after authorization
- **Real-time Messaging**: PostMessage API for popup-to-parent communication

### **API Endpoints:**
- `/api/auth/google` - Initiates Google OAuth flow
- `/api/auth/google/callback` - Handles OAuth callback and token exchange
- `/api/calendar` - Fetches calendar events with authentication
- `/auth-success` - Success/error page for OAuth popup

### **Flow:**
1. Chat API detects calendar request without authorization
2. Returns special message format with `{{CALENDAR_AUTH_BUTTON}}` placeholder
3. Frontend renders interactive button instead of placeholder
4. Button click opens popup with OAuth URL
5. OAuth flow completes in popup
6. Popup sends success/error message to parent window
7. Parent window displays appropriate feedback
8. User can immediately request calendar data

## Testing

1. Start the development server: `npm run dev`
2. Sign in with Auth0
3. Ask about your calendar: "What's on my calendar?"
4. Click the blue "Grant Google Calendar Access" button
5. Complete Google authorization in the popup
6. See success message and ask about calendar again

## Production Considerations

For production deployment:
- Use a secure database to store refresh tokens
- Implement proper token refresh logic
- Add error handling for expired/revoked tokens
- Consider implementing token encryption
- Update redirect URIs for your production domain
- Test popup blockers and provide fallback options
