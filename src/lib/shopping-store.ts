import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// In-memory shopping store
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Cart {
  userId: string;
  items: CartItem[];
}

// Sample products - Common household grocery items
export const PRODUCTS: Product[] = [
  { id: '1', name: 'Milk', description: 'Fresh whole milk, 1 gallon', price: 3.99 },
  { id: '2', name: 'Bread', description: 'Whole wheat bread loaf', price: 2.49 },
  { id: '3', name: 'Eggs', description: 'Large eggs, dozen', price: 2.99 },
  { id: '4', name: 'Bananas', description: 'Fresh bananas, per pound', price: 0.79 },
  { id: '5', name: 'Chicken Breast', description: 'Boneless skinless chicken breast, per pound', price: 6.99 },
  { id: '6', name: 'Rice', description: 'Long grain white rice, 2 lb bag', price: 2.99 },
  { id: '7', name: 'Pasta', description: 'Spaghetti pasta, 1 lb box', price: 1.49 },
  { id: '8', name: 'Tomatoes', description: 'Fresh Roma tomatoes, per pound', price: 1.99 },
  { id: '9', name: 'Cheese', description: 'Cheddar cheese block, 8 oz', price: 4.49 },
  { id: '10', name: 'Apples', description: 'Gala apples, per pound', price: 1.29 },
  { id: '11', name: 'Ground Beef', description: '85% lean ground beef, per pound', price: 5.99 },
  { id: '12', name: 'Onions', description: 'Yellow onions, 3 lb bag', price: 1.99 },
  { id: '13', name: 'Potatoes', description: 'Russet potatoes, 5 lb bag', price: 3.49 },
  { id: '14', name: 'Carrots', description: 'Baby carrots, 1 lb bag', price: 1.49 },
  { id: '15', name: 'Olive Oil', description: 'Extra virgin olive oil, 16.9 fl oz', price: 7.99 },
  { id: '16', name: 'Cereal', description: 'Honey Nut cereal, family size box', price: 4.99 },
  { id: '17', name: 'Orange Juice', description: 'Fresh orange juice, 64 fl oz', price: 3.79 },
  { id: '18', name: 'Yogurt', description: 'Greek yogurt, vanilla, 32 oz container', price: 5.49 },
  { id: '19', name: 'Lettuce', description: 'Iceberg lettuce head', price: 1.79 },
  { id: '20', name: 'Salmon', description: 'Atlantic salmon fillet, per pound', price: 12.99 }
];

// Cart storage with persistence to avoid Next.js hot reload issues
const CART_FILE = join(process.cwd(), '.tmp-carts.json');

function loadCarts(): Cart[] {
  try {
    if (existsSync(CART_FILE)) {
      const data = readFileSync(CART_FILE, 'utf8');
      const carts = JSON.parse(data);
      console.log('=== LOADED CARTS FROM FILE ===');
      console.log('Loaded carts:', carts.map((c: Cart) => ({ userId: c.userId, itemCount: c.items.length })));
      return carts;
    }
  } catch (error) {
    console.log('Error loading carts from file:', error);
  }
  console.log('=== CREATING NEW EMPTY CARTS ARRAY ===');
  return [];
}

function saveCarts(carts: Cart[]): void {
  try {
    writeFileSync(CART_FILE, JSON.stringify(carts, null, 2));
    console.log('=== SAVED CARTS TO FILE ===');
    console.log('Saved carts:', carts.map(c => ({ userId: c.userId, itemCount: c.items.length })));
  } catch (error) {
    console.log('Error saving carts to file:', error);
  }
}

// In-memory cart storage with file persistence
let carts: Cart[] = loadCarts();

// Debug: Log when module is loaded
console.log('=== SHOPPING STORE MODULE LOADED ===');
console.log('Timestamp:', new Date().toISOString());
console.log('Carts array initialized:', carts.length, 'carts');

export function getProducts(): Product[] {
  return PRODUCTS;
}

export function getCart(userId: string): Cart {
  console.log('=== GET CART CALLED ===');
  console.log('User ID:', userId);
  console.log('Total carts in storage:', carts.length);
  console.log('All carts:', carts.map(c => ({ userId: c.userId, itemCount: c.items.length })));
  
  let cart = carts.find(c => c.userId === userId);
  if (!cart) {
    console.log('Creating new cart for user:', userId);
    cart = { userId, items: [] };
    carts.push(cart);
    saveCarts(carts); // Save after adding new cart
    console.log('New cart added. Total carts now:', carts.length);
  } else {
    console.log('Found existing cart for user:', userId, 'with', cart.items.length, 'items');
  }
  return cart;
}

export function addToCart(userId: string, productId: string, quantity: number): boolean {
  console.log('Adding to cart - User ID:', userId, 'Product ID:', productId, 'Quantity:', quantity);
  
  // Check if product exists by ID first, then by name (case-insensitive)
  let product = PRODUCTS.find(p => p.id === productId);
  
  // If not found by ID, try to find by name (case-insensitive)
  if (!product) {
    product = PRODUCTS.find(p => p.name.toLowerCase() === productId.toLowerCase());
  }
  
  if (!product) {
    console.log('Product not found:', productId);
    return false;
  }

  console.log('Found product:', product);

  const cart = getCart(userId);
  console.log('Cart before adding:', cart);
  
  const existingItem = cart.items.find(item => item.productId === product!.id);
  
  if (existingItem) {
    existingItem.quantity += quantity;
    console.log('Updated existing item:', existingItem);
  } else {
    cart.items.push({ productId: product.id, quantity });
    console.log('Added new item to cart');
  }
  
  console.log('Cart after adding:', cart);
  saveCarts(carts); // Save after adding item
  return true;
}

export function getCartWithProducts(userId: string) {
  console.log('Getting cart with products for user:', userId);
  const cart = getCart(userId);
  console.log('Retrieved cart:', cart);
  
  const cartWithProducts = cart.items.map(item => {
    const product = PRODUCTS.find(p => p.id === item.productId);
    console.log('Mapping item:', item, 'Found product:', product);
    return {
      product,
      quantity: item.quantity,
      subtotal: product ? product.price * item.quantity : 0
    };
  });
  
  const total = cartWithProducts.reduce((sum, item) => sum + item.subtotal, 0);
  
  const result = {
    items: cartWithProducts,
    total
  };
  
  console.log('Cart with products result:', result);
  return result;
}

export function clearCart(userId: string): boolean {
  console.log('=== CLEAR CART CALLED ===');
  console.log('User ID:', userId);
  console.log('Current carts before clearing:', carts.map(c => ({ userId: c.userId, itemCount: c.items.length })));
  console.log('Stack trace:', new Error().stack);
  
  const cartIndex = carts.findIndex(cart => cart.userId === userId);
  if (cartIndex !== -1) {
    carts[cartIndex].items = [];
    saveCarts(carts); // Save after clearing cart
    console.log('Cart cleared for user:', userId);
    return true;
  }
  console.log('No cart found to clear for user:', userId);
  return false;
}
