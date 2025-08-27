'use client';

import { UserProvider } from '@auth0/nextjs-auth0/client';
import { ReactNode, useEffect } from 'react';

interface ClientProviderProps {
  children: ReactNode;
}

export default function ClientProvider({ children }: ClientProviderProps) {
  useEffect(() => {
    // Define the popup authorization function for alternate checkout flow
    (window as any).openAuth0Popup = async () => {
      try {
        console.log('=== POPUP AUTHORIZATION INITIATED ===');
        
        // Create popup window for Auth0 authorization
        const popup = window.open(
          '/api/auth/login?returnTo=' + encodeURIComponent(window.location.origin + '/auth-success'),
          'auth0-popup',
          'width=500,height=600,scrollbars=yes,resizable=yes'
        );

        if (!popup) {
          alert('Popup blocked! Please allow popups for this site and try again.');
          return;
        }

        // Listen for popup completion
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            console.log('=== POPUP CLOSED - CHECKING AUTH STATUS ===');
            
            // Check if user is now authenticated and trigger checkout
            setTimeout(async () => {
              try {
                // Check current auth status
                const response = await fetch('/api/auth/me');
                if (response.ok) {
                  const user = await response.json();
                  if (user && user.sub) {
                    console.log('=== USER AUTHENTICATED - TRIGGERING POPUP CHECKOUT ===');
                    
                    // Now trigger the actual checkout via Auth0 AI SDK
                    const checkoutResponse = await fetch('/api/checkout', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        action: 'popup_checkout_complete',
                        userId: user.sub
                      })
                    });

                    if (checkoutResponse.ok) {
                      console.log('=== POPUP CHECKOUT COMPLETED SUCCESSFULLY ===');
                      // Reload to show success message
                      window.location.reload();
                    } else {
                      console.error('Checkout failed:', await checkoutResponse.text());
                      alert('Checkout failed. Please try again.');
                    }
                  } else {
                    console.log('User not authenticated after popup');
                    alert('Authentication failed. Please try again.');
                  }
                } else {
                  console.log('Failed to check auth status');
                  alert('Unable to verify authentication. Please try again.');
                }
              } catch (error) {
                console.error('Error checking auth status:', error);
                alert('Error occurred during checkout. Please try again.');
              }
            }, 500);
          }
        }, 1000);

        // Handle popup completion via postMessage (if needed)
        const messageHandler = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          
          if (event.data.type === 'AUTH_SUCCESS') {
            console.log('=== POPUP AUTH SUCCESS VIA POSTMESSAGE ===');
            popup.close();
            clearInterval(checkClosed);
            window.removeEventListener('message', messageHandler);
            
            // Trigger checkout after successful auth
            setTimeout(async () => {
              try {
                console.log('=== TRIGGERING POPUP CHECKOUT AFTER AUTH SUCCESS ===');
                
                const checkoutResponse = await fetch('/api/checkout', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    action: 'popup_checkout_complete'
                  })
                });

                if (checkoutResponse.ok) {
                  console.log('=== POPUP CHECKOUT COMPLETED SUCCESSFULLY ===');
                  window.location.reload();
                } else {
                  console.error('Checkout failed:', await checkoutResponse.text());
                  alert('Checkout failed. Please try again.');
                }
              } catch (error) {
                console.error('Error during checkout:', error);
                alert('Error occurred during checkout. Please try again.');
              }
            }, 500);
          }
        };

        window.addEventListener('message', messageHandler);

        // Cleanup if popup is manually closed
        popup.addEventListener('beforeunload', () => {
          clearInterval(checkClosed);
          window.removeEventListener('message', messageHandler);
        });

      } catch (error) {
        console.error('Popup authorization error:', error);
        alert('Authorization failed. Please try again.');
      }
    };

    // Cleanup function
    return () => {
      delete (window as any).openAuth0Popup;
    };
  }, []);

  return <UserProvider>{children}</UserProvider>;
}
