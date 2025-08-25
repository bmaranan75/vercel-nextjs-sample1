// Simple in-memory shopping store for demo purposes
// In a real app, this would be backed by a database

interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
}

interface CartItem {
  productId: string;
  quantity: number;
  product?: Product;
}

interface Cart {
  items: CartItem[];
  total: number;
}

// Demo products
const products: Product[] = [
  { id: 1, name: "Milk", description: "Fresh whole milk 1L", price: 2.99 },
  { id: 2, name: "Bread", description: "Whole wheat bread loaf", price: 3.49 },
  { id: 3, name: "Eggs", description: "Free-range eggs (dozen)", price: 4.99 },
  { id: 4, name: "Apples", description: "Red apples (1kg)", price: 3.99 },
  { id: 5, name: "Rice", description: "Jasmine rice (2kg)", price: 8.99 },
  { id: 6, name: "Chicken", description: "Fresh chicken breast (500g)", price: 7.99 },
  { id: 7, name: "Tomatoes", description: "Fresh tomatoes (500g)", price: 2.49 },
  { id: 8, name: "Onions", description: "Yellow onions (1kg)", price: 1.99 },
  { id: 9, name: "Cheese", description: "Cheddar cheese (200g)", price: 5.49 },
  { id: 10, name: "Yogurt", description: "Greek yogurt (500g)", price: 4.49 }
];

// In-memory cart storage (in a real app, this would be in a database)
const userCarts: Record<string, CartItem[]> = {};

export function getProducts(): Product[] {
  return products;
}

export function addToCart(userId: string, productId: string, quantity: number = 1): boolean {
  // Find product by ID or name
  const product = products.find(p => 
    p.id.toString() === productId.toString() || 
    p.name.toLowerCase() === productId.toLowerCase()
  );
  
  if (!product) {
    return false;
  }
  
  // Initialize cart if it doesn't exist
  if (!userCarts[userId]) {
    userCarts[userId] = [];
  }
  
  // Check if item already exists in cart
  const existingItem = userCarts[userId].find(item => item.productId === product.id.toString());
  
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    userCarts[userId].push({
      productId: product.id.toString(),
      quantity
    });
  }
  
  return true;
}

export function getCartWithProducts(userId: string): Cart {
  const cartItems = userCarts[userId] || [];
  
  const itemsWithProducts = cartItems.map(item => ({
    ...item,
    product: products.find(p => p.id.toString() === item.productId)
  })).filter(item => item.product); // Filter out items with no matching product
  
  const total = itemsWithProducts.reduce((sum, item) => {
    return sum + (item.product!.price * item.quantity);
  }, 0);
  
  return {
    items: itemsWithProducts,
    total
  };
}

export function clearCart(userId: string): void {
  delete userCarts[userId];
}

export function getCart(userId: string): CartItem[] {
  return userCarts[userId] || [];
}
