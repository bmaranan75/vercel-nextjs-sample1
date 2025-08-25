// CIBA (Client Initiated Backchannel Authentication) storage for demo purposes
// In a real app, this would be backed by a database with proper security

interface CibaRequest {
  authReqId: string;
  userId: string;
  cartData: any;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  createdAt: Date;
  expiresAt: Date;
}

// In-memory storage for CIBA requests
const cibaRequests: Record<string, CibaRequest> = {};

export function createCibaRequest(authReqId: string, userId: string, cartData: any): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
  
  cibaRequests[authReqId] = {
    authReqId,
    userId,
    cartData,
    status: 'pending',
    createdAt: now,
    expiresAt
  };
  
  console.log('CIBA request created:', { authReqId, userId, status: 'pending' });
}

export function getCibaRequest(authReqId: string): CibaRequest | null {
  const request = cibaRequests[authReqId];
  
  if (!request) {
    return null;
  }
  
  // Check if expired
  if (new Date() > request.expiresAt) {
    request.status = 'expired';
  }
  
  return request;
}

export function updateCibaRequestStatus(authReqId: string, status: 'approved' | 'denied'): boolean {
  const request = cibaRequests[authReqId];
  
  if (!request) {
    return false;
  }
  
  // Check if expired
  if (new Date() > request.expiresAt) {
    request.status = 'expired';
    return false;
  }
  
  request.status = status;
  console.log('CIBA request status updated:', { authReqId, status });
  return true;
}

export function deleteCibaRequest(authReqId: string): void {
  delete cibaRequests[authReqId];
  console.log('CIBA request deleted:', authReqId);
}

export function getAllCibaRequests(): Record<string, CibaRequest> {
  return cibaRequests;
}

// Cleanup expired requests periodically
setInterval(() => {
  const now = new Date();
  Object.keys(cibaRequests).forEach(authReqId => {
    if (now > cibaRequests[authReqId].expiresAt) {
      console.log('Cleaning up expired CIBA request:', authReqId);
      delete cibaRequests[authReqId];
    }
  });
}, 60000); // Run every minute
