/**
 * Cart Storage Test Script
 * Run with: node test-cart-storage.js
 */

const {cartStorage} = require('./src/lib/cart-storage');

async function testCartStorage() {
  console.log('🧪 Testing Cart Storage...\n');

  const testUserId = 'test-user-123';
  const testCart = {
    userId: testUserId,
    items: [
      {productId: '1', quantity: 2},
      {productId: '3', quantity: 1},
    ],
  };

  try {
    // Test 1: Save a cart
    console.log('1️⃣ Testing cart save...');
    await cartStorage.saveUserCart(testCart);
    console.log('✅ Cart saved successfully');

    // Test 2: Retrieve the cart
    console.log('\n2️⃣ Testing cart retrieval...');
    const retrievedCart = await cartStorage.getUserCart(testUserId);
    console.log('✅ Cart retrieved:', JSON.stringify(retrievedCart, null, 2));

    // Test 3: Clear the cart
    console.log('\n3️⃣ Testing cart clearing...');
    await cartStorage.clearUserCart(testUserId);
    const clearedCart = await cartStorage.getUserCart(testUserId);
    console.log(
      '✅ Cart after clearing:',
      JSON.stringify(clearedCart, null, 2),
    );

    // Test 4: Delete the cart
    console.log('\n4️⃣ Testing cart deletion...');
    await cartStorage.deleteUserCart(testUserId);
    const deletedCart = await cartStorage.getUserCart(testUserId);
    console.log('✅ Cart after deletion:', deletedCart);

    console.log('\n🎉 All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testCartStorage();
}

module.exports = {testCartStorage};
