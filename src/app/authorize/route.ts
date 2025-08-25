import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getCibaRequest, updateCibaRequestStatus } from '../../lib/ciba-storage';

export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.redirect(new URL('/api/auth/login', request.url));
    }

    const searchParams = request.nextUrl.searchParams;
    const authReqId = searchParams.get('auth_req_id');
    const bindingMessage = searchParams.get('binding_message');
    
    if (!authReqId) {
      return new NextResponse(`
        <html>
          <head><title>Authorization Error</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2>❌ Authorization Error</h2>
            <p>Missing authorization request ID.</p>
            <button onclick="window.close()">Close</button>
          </body>
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

    // Get the CIBA request
    const cibaRequest = getCibaRequest(authReqId);
    
    if (!cibaRequest) {
      return new NextResponse(`
        <html>
          <head><title>Authorization Error</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2>❌ Authorization Request Not Found</h2>
            <p>The authorization request may have expired or been processed already.</p>
            <button onclick="window.close()">Close</button>
          </body>
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

    // Check if expired
    if (cibaRequest.status === 'expired') {
      return new NextResponse(`
        <html>
          <head><title>Authorization Expired</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2>⏰ Authorization Request Expired</h2>
            <p>This authorization request has expired. Please try again.</p>
            <button onclick="window.close()">Close</button>
          </body>
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

    // Check if already processed
    if (cibaRequest.status !== 'pending') {
      return new NextResponse(`
        <html>
          <head><title>Already Processed</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2>✅ Already Processed</h2>
            <p>This authorization request has already been ${cibaRequest.status}.</p>
            <button onclick="window.close()">Close</button>
          </body>
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

    // Verify this is the right user
    if (cibaRequest.userId !== session.user.sub) {
      return new NextResponse(`
        <html>
          <head><title>Unauthorized</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2>❌ Unauthorized</h2>
            <p>You are not authorized to approve this request.</p>
            <button onclick="window.close()">Close</button>
          </body>
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }

    // Show authorization page
    return new NextResponse(`
      <html>
        <head>
          <title>Authorize Checkout</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { 
              font-family: Arial, sans-serif; 
              padding: 20px; 
              max-width: 500px; 
              margin: 0 auto; 
              background-color: #f5f5f5;
            }
            .container {
              background: white;
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header { 
              text-align: center; 
              color: #333;
              margin-bottom: 20px;
            }
            .message {
              background: #f8f9fa;
              padding: 15px;
              border-radius: 6px;
              margin: 15px 0;
              border-left: 4px solid #007bff;
            }
            .buttons {
              display: flex;
              gap: 10px;
              justify-content: center;
              margin-top: 20px;
            }
            button {
              padding: 12px 24px;
              border: none;
              border-radius: 6px;
              font-size: 16px;
              cursor: pointer;
              font-weight: 500;
            }
            .approve {
              background-color: #28a745;
              color: white;
            }
            .approve:hover {
              background-color: #218838;
            }
            .deny {
              background-color: #dc3545;
              color: white;
            }
            .deny:hover {
              background-color: #c82333;
            }
            .loading {
              text-align: center;
              color: #666;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>🔐 Authorize Checkout</h2>
              <p>Hello, ${session.user.name || session.user.email}!</p>
            </div>
            
            <div class="message">
              <strong>Authorization Request:</strong><br>
              ${bindingMessage || 'Checkout authorization required'}
            </div>
            
            <div class="buttons">
              <button class="approve" onclick="authorize(true)">
                ✅ Approve
              </button>
              <button class="deny" onclick="authorize(false)">
                ❌ Deny
              </button>
            </div>
            
            <div id="loading" class="loading" style="display: none;">
              Processing your decision...
            </div>
          </div>

          <script>
            async function authorize(approved) {
              document.querySelector('.buttons').style.display = 'none';
              document.getElementById('loading').style.display = 'block';
              
              try {
                const response = await fetch('/api/authorize', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    authReqId: '${authReqId}',
                    approved: approved
                  })
                });
                
                const result = await response.json();
                
                if (result.success) {
                  document.getElementById('loading').innerHTML = 
                    approved ? 
                    '✅ Approved! You can close this window.' : 
                    '❌ Denied! You can close this window.';
                  
                  // Auto-close after 2 seconds
                  setTimeout(() => {
                    window.close();
                  }, 2000);
                } else {
                  document.getElementById('loading').innerHTML = 
                    '❌ Error: ' + (result.message || 'Unknown error');
                }
              } catch (error) {
                console.error('Authorization error:', error);
                document.getElementById('loading').innerHTML = 
                  '❌ Error processing authorization. Please try again.';
              }
            }
          </script>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });

  } catch (error) {
    console.error('Authorization page error:', error);
    return new NextResponse(`
      <html>
        <head><title>Error</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2>❌ Error</h2>
          <p>An error occurred while loading the authorization page.</p>
          <button onclick="window.close()">Close</button>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }
}
