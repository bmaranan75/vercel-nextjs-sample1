// Shared CIBA request storage
// In a real implementation, this would be stored in a database or Redis cache
// For this demo, we'll use file-based storage to persist between API calls

import fs from 'fs';
import path from 'path';

interface CibaRequest {
  userId: string;
  status: 'pending' | 'approved' | 'denied';
  timestamp: number;
  checkoutData?: any;
}

// Use a JSON file for persistence between API route calls
const STORAGE_FILE = path.join(process.cwd(), '.ciba-requests.json');

function loadRequests(): Map<string, CibaRequest> {
  console.log('Loading requests from:', STORAGE_FILE);
  console.log('Current working directory:', process.cwd());
  console.log('File exists:', fs.existsSync(STORAGE_FILE));
  
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, 'utf8');
      console.log('Raw file data:', data);
      const parsed = JSON.parse(data);
      const map = new Map(Object.entries(parsed) as [string, CibaRequest][]);
      console.log('Loaded requests map:', Array.from(map.keys()));
      return map;
    }
  } catch (error) {
    console.error('Error loading CIBA requests:', error);
  }
  console.log('Returning empty map');
  return new Map();
}

function saveRequests(requests: Map<string, CibaRequest>): void {
  try {
    const data = Object.fromEntries(requests);
    console.log('Saving CIBA requests to file:', STORAGE_FILE);
    console.log('Current working directory:', process.cwd());
    console.log('Data to save:', data);
    
    // Ensure directory exists
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log('Created directory:', dir);
    }
    
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
    console.log('CIBA requests saved successfully');
    
    // Verify the file was written
    if (fs.existsSync(STORAGE_FILE)) {
      const verification = fs.readFileSync(STORAGE_FILE, 'utf8');
      console.log('Verification - file content:', verification);
    } else {
      console.error('File was not created after write!');
    }
  } catch (error) {
    console.error('Error saving CIBA requests:', error);
  }
}

export const cibaRequests = loadRequests();

export function createCibaRequest(authReqId: string, userId: string, checkoutData?: any): void {
  const requests = loadRequests();
  console.log('Creating CIBA request - loaded existing requests:', requests.size);
  
  requests.set(authReqId, {
    userId,
    status: 'pending',
    timestamp: Date.now(),
    checkoutData
  });
  
  console.log('About to save CIBA request with authReqId:', authReqId);
  saveRequests(requests);
  console.log('CIBA request saved. Verifying by loading again...');
  
  const verification = loadRequests();
  console.log('Verification - requests after save:', Array.from(verification.keys()));
}

export function getCibaRequest(authReqId: string): CibaRequest | undefined {
  const requests = loadRequests();
  console.log('Getting CIBA request - available requests:', Array.from(requests.keys()));
  console.log('Looking for authReqId:', authReqId);
  return requests.get(authReqId);
}

export function updateCibaRequest(authReqId: string, status: 'approved' | 'denied'): boolean {
  const requests = loadRequests();
  const request = requests.get(authReqId);
  if (request) {
    request.status = status;
    requests.set(authReqId, request);
    saveRequests(requests);
    return true;
  }
  return false;
}

export function deleteCibaRequest(authReqId: string): boolean {
  const requests = loadRequests();
  const deleted = requests.delete(authReqId);
  if (deleted) {
    saveRequests(requests);
  }
  return deleted;
}
