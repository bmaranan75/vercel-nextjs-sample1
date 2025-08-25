import { getSession } from '@auth0/nextjs-auth0';

// Get the user from Auth0 session
export const getUser = async () => {
  const session = await getSession();
  return session?.user;
};

// Get the access token from Auth0 session
export const getAccessToken = async () => {
  const session = await getSession();
  return session?.accessToken;
};
