import fs from 'fs';
import path from 'path';

const POPUP_REQUESTS_FILE = path.join(process.cwd(), '.popup-requests.json');

interface PopupRequest {
  id: string;
  userId: string;
  cartData: any;
  status: 'pending' | 'completed' | 'failed';
  result?: any;
  error?: string;
  timestamp: number;
  expiresAt: number;
}

// Store popup requests
const requests = new Map<string, PopupRequest>();

// Load requests from file on startup
function loadRequests() {
  try {
    if (fs.existsSync(POPUP_REQUESTS_FILE)) {
      const data = fs.readFileSync(POPUP_REQUESTS_FILE, 'utf-8');
      const saved = JSON.parse(data);
      requests.clear();
      Object.entries(saved).forEach(([id, request]) => {
        requests.set(id, request as PopupRequest);
      });
    }
  } catch (error) {
    console.error('Error loading popup requests:', error);
  }
}

// Save requests to file
function saveRequests() {
  try {
    const data = Object.fromEntries(requests.entries());
    fs.writeFileSync(POPUP_REQUESTS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving popup requests:', error);
  }
}

// Generate unique request ID
function generateRequestId(): string {
  return `popup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Store a new popup request
export function storePopupRequest(userId: string, cartData: any): string {
  loadRequests();
  
  const id = generateRequestId();
  const request: PopupRequest = {
    id,
    userId,
    cartData,
    status: 'pending',
    timestamp: Date.now(),
    expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
  };
  
  requests.set(id, request);
  saveRequests();
  
  return id;
}

// Get popup request by ID
export function getPopupRequest(id: string): PopupRequest | null {
  loadRequests();
  
  const request = requests.get(id);
  if (!request) return null;
  
  // Check if expired
  if (Date.now() > request.expiresAt) {
    requests.delete(id);
    saveRequests();
    return null;
  }
  
  return request;
}

// Update popup request status
export function updatePopupRequest(id: string, status: 'completed' | 'failed', result?: any, error?: string): boolean {
  loadRequests();
  
  const request = requests.get(id);
  if (!request) return false;
  
  request.status = status;
  if (result) request.result = result;
  if (error) request.error = error;
  
  requests.set(id, request);
  saveRequests();
  
  return true;
}

// Get pending popup requests for a user
export function getUserPopupRequests(userId: string): PopupRequest[] {
  loadRequests();
  
  const userRequests = Array.from(requests.values())
    .filter(request => request.userId === userId)
    .filter(request => Date.now() <= request.expiresAt)
    .sort((a, b) => b.timestamp - a.timestamp);
  
  return userRequests;
}

// Clean up expired requests
export function cleanupExpiredRequests() {
  loadRequests();
  
  const now = Date.now();
  const toDelete: string[] = [];
  
  requests.forEach((request, id) => {
    if (now > request.expiresAt) {
      toDelete.push(id);
    }
  });
  
  toDelete.forEach(id => requests.delete(id));
  
  if (toDelete.length > 0) {
    saveRequests();
  }
  
  return toDelete.length;
}
