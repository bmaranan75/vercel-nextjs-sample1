# Cart Storage with Vercel Blob

This application now uses Vercel Blob storage for cart persistence in production environments, with automatic fallback to file storage in development.

## Features

- **Development**: File-based storage (`.tmp-carts.json`)
- **Production**: Vercel Blob storage for scalable persistence
- **Automatic Detection**: Environment-based storage selection
- **User Isolation**: Each user's cart is stored separately
- **Async Operations**: All cart operations are now async for better performance

## Environment Variables

### Required for Production (Vercel)

```env
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

You can obtain this token from your Vercel dashboard:

1. Go to your Vercel project settings
2. Navigate to "Storage" tab
3. Create a new Blob store or use existing one
4. Copy the `BLOB_READ_WRITE_TOKEN`

### Development Setup

No additional setup needed for development. The app will automatically use file storage.

## Storage Structure

### Development (File Storage)

- File: `.tmp-carts.json`
- Format: Array of cart objects
- Location: Project root directory

### Production (Vercel Blob)

- Individual files per user: `cart-{userId}.json`
- Format: Single cart object per file
- Storage: Vercel Blob (globally distributed)

## API Changes

All cart-related functions are now async:

```typescript
// Before
const cart = getCart(userId);
const cartData = getCartWithProducts(userId);
addToCart(userId, productId, quantity);
clearCart(userId);

// After
const cart = await getCart(userId);
const cartData = await getCartWithProducts(userId);
await addToCart(userId, productId, quantity);
await clearCart(userId);
```

## Benefits

1. **Scalability**: Vercel Blob can handle unlimited carts
2. **Performance**: Global CDN distribution for fast access
3. **Reliability**: High availability and durability
4. **Development**: Seamless local development with file fallback
5. **Cost-Effective**: Pay-per-use pricing model

## Monitoring

The application logs cart operations for debugging:

- Cart creation and retrieval
- Storage method used (file vs blob)
- Error handling and fallbacks
- Performance metrics

## Migration

Existing file-based carts will continue to work in development. For production deployment:

1. Set up Vercel Blob storage
2. Add `BLOB_READ_WRITE_TOKEN` to environment variables
3. Deploy - new carts will automatically use Blob storage

## Error Handling

- Graceful degradation if Blob storage is unavailable
- Automatic retry mechanisms
- Detailed logging for troubleshooting
- Fallback to local storage when possible
