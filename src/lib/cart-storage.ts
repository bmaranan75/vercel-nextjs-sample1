import { put, list, del } from '@vercel/blob';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Cart } from './shopping-store';

const CART_FILE = join(process.cwd(), '.tmp-carts.json');

/**
 * Cart Storage Service
 * Uses Vercel Blob in production, file storage in development
 */
export class CartStorage {
  private isProduction = process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV;

  /**
   * Get all carts for all users
   */
  async getAllCarts(): Promise<Cart[]> {
    if (this.isProduction) {
      return this.getBlobCarts();
    } else {
      return this.getFileCarts();
    }
  }

  /**
   * Save all carts
   */
  async saveAllCarts(carts: Cart[]): Promise<void> {
    if (this.isProduction) {
      await this.saveBlobCarts(carts);
    } else {
      this.saveFileCarts(carts);
    }
  }

  /**
   * Get a specific user's cart
   */
  async getUserCart(userId: string): Promise<Cart | null> {
    if (this.isProduction) {
      try {
        const { blobs } = await list({ prefix: `cart-${userId}` });
        if (blobs.length === 0) return null;
        
        const response = await fetch(blobs[0].url);
        return await response.json();
      } catch (error) {
        console.log('Error getting user cart from blob:', error);
        return null;
      }
    } else {
      const carts = this.getFileCarts();
      return carts.find(cart => cart.userId === userId) || null;
    }
  }

  /**
   * Save a specific user's cart
   */
  async saveUserCart(cart: Cart): Promise<void> {
    if (this.isProduction) {
      try {
        const cartKey = `cart-${cart.userId}.json`;
        await put(cartKey, JSON.stringify(cart), {
          access: 'public',
          addRandomSuffix: false,
        });
        console.log('Saved cart to Vercel Blob for user:', cart.userId);
      } catch (error) {
        console.error('Error saving cart to blob:', error);
        // Fallback to in-memory for this session
        throw error;
      }
    } else {
      const carts = this.getFileCarts();
      const existingIndex = carts.findIndex(c => c.userId === cart.userId);
      
      if (existingIndex >= 0) {
        carts[existingIndex] = cart;
      } else {
        carts.push(cart);
      }
      
      this.saveFileCarts(carts);
    }
  }

  /**
   * Delete a specific user's cart
   */
  async deleteUserCart(userId: string): Promise<void> {
    if (this.isProduction) {
      try {
        const { blobs } = await list({ prefix: `cart-${userId}` });
        
        for (const blob of blobs) {
          await del(blob.url);
        }
        
        console.log('Deleted cart from Vercel Blob for user:', userId);
      } catch (error) {
        console.error('Error deleting cart from blob:', error);
      }
    } else {
      const carts = this.getFileCarts();
      const filteredCarts = carts.filter(c => c.userId !== userId);
      this.saveFileCarts(filteredCarts);
    }
  }

  /**
   * Clear a specific user's cart items (but keep the cart)
   */
  async clearUserCart(userId: string): Promise<void> {
    const cart = await this.getUserCart(userId);
    if (cart) {
      cart.items = [];
      await this.saveUserCart(cart);
    }
  }

  // Private methods for blob storage
  private async getBlobCarts(): Promise<Cart[]> {
    try {
      const { blobs } = await list({ prefix: 'cart-' });
      const carts: Cart[] = [];
      
      for (const blob of blobs) {
        try {
          const response = await fetch(blob.url);
          const cart = await response.json();
          carts.push(cart);
        } catch (error) {
          console.log('Error reading cart blob:', blob.pathname, error);
        }
      }
      
      console.log('Loaded', carts.length, 'carts from Vercel Blob');
      return carts;
    } catch (error) {
      console.log('Error loading carts from blob:', error);
      return [];
    }
  }

  private async saveBlobCarts(carts: Cart[]): Promise<void> {
    try {
      // Save each cart individually
      for (const cart of carts) {
        await this.saveUserCart(cart);
      }
    } catch (error) {
      console.error('Error saving carts to blob:', error);
    }
  }

  // Private methods for file storage (development)
  private getFileCarts(): Cart[] {
    try {
      if (existsSync(CART_FILE)) {
        const data = readFileSync(CART_FILE, 'utf8');
        const carts = JSON.parse(data);
        console.log('Loaded carts from file:', carts.map((c: Cart) => ({ userId: c.userId, itemCount: c.items.length })));
        return carts;
      }
    } catch (error) {
      console.log('Error loading carts from file:', error);
    }
    return [];
  }

  private saveFileCarts(carts: Cart[]): void {
    try {
      writeFileSync(CART_FILE, JSON.stringify(carts, null, 2));
      console.log('Saved carts to file:', carts.map(c => ({ userId: c.userId, itemCount: c.items.length })));
    } catch (error) {
      console.log('Error saving carts to file:', error);
    }
  }
}

// Export a singleton instance
export const cartStorage = new CartStorage();
