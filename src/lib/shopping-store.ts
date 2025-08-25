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

// In-memory cart storage
const carts: Cart[] = [];

export function getProducts(): Product[] {
  return PRODUCTS;
}

export function getCart(userId: string): Cart {
  let cart = carts.find(c => c.userId === userId);
  if (!cart) {
    cart = { userId, items: [] };
    carts.push(cart);
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
  const cartIndex = carts.findIndex(cart => cart.userId === userId);
  if (cartIndex !== -1) {
    carts[cartIndex].items = [];
    return true;
  }
  return false;
}
