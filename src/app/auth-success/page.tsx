'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function AuthSuccessContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'success' | 'error' | 'loading'>('loading');
  const error = searchParams.get('error');
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  useEffect(() => {
    console.log('Auth success page loaded');
    console.log('Search params:', Object.fromEntries(searchParams.entries()));
    console.log('Code:', code);
    console.log('State:', state);
    console.log('Error:', error);
    console.log('Window opener exists:', !!window.opener);

    // Check if this is a Google Calendar authorization based on 'type' parameter
    const type = searchParams.get('type');
    
    // Determine the type of authorization
    let authType = 'popup_checkout'; // default to popup checkout
    if (type === 'google') {
      authType = 'google';
    } else if (state) {
      try {
        const stateData = JSON.parse(state);
        if (stateData.action === 'popup_checkout') {
          authType = 'popup_checkout';
        }
      } catch (e) {
        // If state is not JSON parseable, it might be a Google auth userId
        // Check if it's just a string (Google auth passes userId as state)
        if (typeof state === 'string' && !state.includes('{')) {
          authType = 'google';
        }
      }
    }

    console.log('Auth type determined:', authType);

    if (error || (type === 'google' && (error === 'denied' || error === 'failed'))) {
      setStatus('error');
      console.log('Sending error message for auth type:', authType);
      // Send error message to parent window based on auth type
      if (window.opener) {
        if (authType === 'google') {
          window.opener.postMessage({
            type: 'GOOGLE_AUTH_ERROR',
            error: error || 'Authorization failed'
          }, window.location.origin);
        } else if (authType === 'popup_checkout') {
          window.opener.postMessage({
            type: 'AUTH_ERROR',
            error: error || 'Authorization failed'
          }, window.location.origin);
        }
        
        setTimeout(() => {
          window.close();
        }, 3000);
      }
    } else if (code || type === 'google') {
      // We have an authorization code from Auth0 OR this is a successful Google auth
      setStatus('success');
      console.log('Sending success message for auth type:', authType);
      // Send success message to parent window based on auth type
      if (window.opener) {
        if (authType === 'google') {
          window.opener.postMessage({
            type: 'GOOGLE_AUTH_SUCCESS'
          }, window.location.origin);
        } else if (authType === 'popup_checkout') {
          window.opener.postMessage({
            type: 'AUTH_SUCCESS',
            code: code,
            state: state
          }, window.location.origin);
        }
        
        setTimeout(() => {
          window.close();
        }, 2000);
      }
    } else {
      // No code and no error - something's wrong
      console.log('No code or error received');
      setStatus('error');
      if (window.opener) {
        if (authType === 'google') {
          window.opener.postMessage({
            type: 'GOOGLE_AUTH_ERROR',
            error: 'No authorization code received'
          }, window.location.origin);
        } else if (authType === 'popup_checkout') {
          window.opener.postMessage({
            type: 'AUTH_ERROR',
            error: 'No authorization code received'
          }, window.location.origin);
        }
        
        setTimeout(() => {
          window.close();
        }, 3000);
      }
    }
  }, [error, code, state, searchParams]);

  const getContent = () => {
    if (status === 'error') {
      return {
        icon: (
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        ),
        bgColor: 'bg-red-100',
        title: 'Authorization Failed',
        message: error === 'denied' 
          ? 'You denied access to Google Calendar.' 
          : 'There was an error during authorization.',
        note: 'This window will close automatically...'
      };
    }

    return {
      icon: (
        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
        </svg>
      ),
      bgColor: 'bg-green-100',
      title: 'Authorization Successful!',
      message: 'Google Calendar access has been granted successfully.',
      note: 'This window will close automatically...'
    };
  };

  const content = getContent();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
        <div className="mb-4">
          <div className={`mx-auto w-16 h-16 ${content.bgColor} rounded-full flex items-center justify-center`}>
            {content.icon}
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {content.title}
        </h1>
        <p className="text-gray-600 mb-4">
          {content.message}
        </p>
        <p className="text-sm text-gray-500">
          {content.note}
        </p>
      </div>
    </div>
  );
}

export default function AuthSuccess() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <AuthSuccessContent />
    </Suspense>
  );
}
