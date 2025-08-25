'use client';

import { useEffect, useState } from 'react';

interface PageProps {
  searchParams: Promise<{ 
    auth_req_id?: string;
    binding_message?: string;
  }>;
}

export default function AuthorizePage(props: PageProps) {
  const [authRequest, setAuthRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [authReqId, setAuthReqId] = useState<string | null>(null);
  const [isPopup, setIsPopup] = useState(false);

  // Function to check if window is opened as popup
  const checkIsPopup = () => {
    try {
      return window.opener !== null || window.name === 'authorization';
    } catch (e) {
      return false;
    }
  };

  useEffect(() => {
    // Set initial popup state
    setIsPopup(checkIsPopup());

    const loadSearchParams = async () => {
      const searchParams = await props.searchParams;
      const id = searchParams.auth_req_id;
      const bindingMessage = searchParams.binding_message;
      setAuthReqId(id || null);
      
      if (id) {
        // Check if the authorization request still exists and is valid
        try {
          const statusResponse = await fetch('/api/ciba-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ authReqId: id })
          });

          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            if (statusData.status === 'approved') {
              // Already approved - close immediately
              alert('✅ This checkout has already been approved and completed. This window will close automatically.');
              setTimeout(() => {
                if (checkIsPopup()) {
                  window.close();
                } else {
                  window.location.href = '/?auth_complete=true';
                }
              }, 1500);
              setLoading(false);
              return; // Don't set authRequest, just close
            } else if (statusData.status === 'access_denied') {
              // Already denied - close immediately
              alert('❌ This authorization has already been denied. This window will close automatically.');
              setTimeout(() => {
                if (checkIsPopup()) {
                  window.close();
                } else {
                  window.location.href = '/?auth_complete=true';
                }
              }, 1500);
              setLoading(false);
              return; // Don't set authRequest, just close
            } else {
              // Still pending
              setAuthRequest({
                authReqId: id,
                bindingMessage: bindingMessage ? decodeURIComponent(bindingMessage) : 'Do you want to complete checkout for your cart items?',
                status: 'pending',
                requestedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
              });
            }
          } else {
            // Request not found or error - likely already processed or invalid
            console.log('Authorization request not found or error:', statusResponse.status);
            // Don't auto-close immediately, let user see what happened
            setAuthRequest({
              authReqId: id,
              bindingMessage: 'This authorization request has expired, been processed, or is invalid.',
              status: 'expired',
              requestedAt: new Date().toISOString(),
              expiresAt: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error('Error checking authorization status:', error);
          // Fallback to creating a mock request
          setAuthRequest({
            authReqId: id,
            bindingMessage: bindingMessage ? decodeURIComponent(bindingMessage) : 'Do you want to complete checkout for your cart items?',
            status: 'pending',
            requestedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
          });
        }
      }
      setLoading(false);
    };
    
    loadSearchParams();
  }, [props.searchParams]);

  const handleAuthorization = async (action: 'approve' | 'deny') => {
    if (!authReqId) return;
    
    setProcessing(true);
    try {
      const response = await fetch('/api/ciba-token', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authReqId,
          action
        })
      });

      if (response.ok) {
        // Show success message
        if (action === 'approve') {
          alert('✅ Authorization approved successfully! This window will close automatically.');
        } else {
          alert('❌ Authorization denied successfully! This window will close automatically.');
        }
        
        // Close the window after a short delay to allow the user to see the message
        setTimeout(() => {
          if (checkIsPopup()) {
            // If opened as popup, try to close it
            window.close();
          } else {
            // If opened in new tab, redirect back to main app or show success page
            window.location.href = '/?auth_complete=true';
          }
        }, 1500);
      } else if (response.status === 404) {
        // Request not found - likely already processed
        alert('✅ This authorization request has already been processed. This window will close automatically.');
        setTimeout(() => {
          if (checkIsPopup()) {
            window.close();
          } else {
            window.location.href = '/?auth_complete=true';
          }
        }, 1500);
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(`Failed to ${action} authorization: ${errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Authorization error:', error);
      alert(`Error during authorization: ${error}`);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 text-center">Loading authorization request...</p>
        </div>
      </div>
    );
  }

  if (!authRequest) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
          <div className="text-red-600 text-center">
            <svg className="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <h2 className="text-xl font-semibold mb-2">Invalid Request</h2>
            <p className="text-gray-600">This authorization request is invalid or has expired.</p>
          </div>
        </div>
      </div>
    );
  }

  // Handle expired/processed requests
  if (authRequest.status === 'expired') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
          <div className="text-yellow-600 text-center">
            <svg className="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <h2 className="text-xl font-semibold mb-2">Request Expired</h2>
            <p className="text-gray-600 mb-4">{authRequest.bindingMessage}</p>
            <button
              onClick={() => {
                if (checkIsPopup()) {
                  window.close();
                } else {
                  window.location.href = '/';
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-200"
            >
              Close Window
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Authorization Required</h1>
          <p className="text-gray-600">A checkout request requires your approval</p>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-gray-900 mb-2">Request Details:</h3>
          <p className="text-gray-700 mb-3">{authRequest.bindingMessage}</p>
          <div className="text-sm text-gray-500">
            <p>Request ID: {authRequest.authReqId}</p>
            <p>Requested: {new Date(authRequest.requestedAt).toLocaleString()}</p>
            <p>Expires: {new Date(authRequest.expiresAt).toLocaleString()}</p>
          </div>
        </div>

        <div className="flex space-x-4">
          <button
            onClick={() => handleAuthorization('deny')}
            disabled={processing}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-semibold py-3 px-4 rounded-lg transition duration-200"
          >
            {processing ? 'Processing...' : 'Deny'}
          </button>
          <button
            onClick={() => handleAuthorization('approve')}
            disabled={processing}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold py-3 px-4 rounded-lg transition duration-200"
          >
            {processing ? 'Processing...' : 'Approve'}
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-4">
          This simulates Auth0 Guardian push notification approval.<br/>
          <span className="text-blue-600">
            {isPopup 
              ? 'This popup will close automatically after approval.' 
              : 'This tab will redirect back to the main app after approval.'
            }
          </span>
        </p>
      </div>
    </div>
  );
}
