import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(process.cwd(), '.env') })

export default {
  ip_address: process.env.IP_ADDRESS,
  database_url: process.env.DATABASE_URL,
  node_env: process.env.NODE_ENV,
  clientUrl: (process.env.clientUrl?.trim() || 'https://roadtripeado.com')
    .replace(/^https?:\/\/(www\.)?roadtripeado\.shop(?=\/|$)/i, 'https://roadtripeado.com')
    .replace(/\/+$/, ''),
  port: process.env.PORT,
  cors_origins: Array.from(new Set(['https://roadtripeado.com', ...(process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['https://roadtripeado.shop', 'https://roadtripeado.com', 'http://localhost:3000'])]
    .map(origin => origin.trim().replace(/\/+$/, '')).filter(Boolean))),
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
  server_map_api_key: process.env.SERVER_MAP_API_KEY,
  google: {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    callback_url: process.env.GOOGLE_CALLBACK_URL,
  },
  facebook: {
    app_id: process.env.FACEBOOK_APP_ID,
    app_secret: process.env.FACEBOOK_APP_SECRET,
    callback_url: process.env.FACEBOOK_CALLBACK_URL,
  },
  instagram: {
    client_id: process.env.INSTAGRAM_CLIENT_ID,
    client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
    callback_url: process.env.INSTAGRAM_CALLBACK_URL,
  },
  tikok: {
    client_id: process.env.TIKTOK_CLIENT_ID,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    callback_url: process.env.TIKTOK_CALLBACK_URL,
  },
  aws: {
    access_key_id: process.env.AWS_ACCESS_KEY_ID,
    secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    bucket_name: process.env.AWS_BUCKET_NAME,
  },

  jwt: {
    jwt_secret: process.env.JWT_SECRET,
    jwt_expire_in: process.env.JWT_EXPIRE_IN,
    jwt_refresh_secret: process.env.JWT_REFRESH_SECRET,
    jwt_refresh_expire_in: process.env.JWT_REFRESH_EXPIRES_IN,
    jwt_refresh_expire_long: process.env.JWT_REFRESH_EXPIRE_LONG,
    temp_jwt_secret: process.env.TEMP_JWT_SECRET,
    temp_jwt_expire_in: process.env.TEMP_JWT_EXPIRE_IN,
  },
  email: {
    from: process.env.EMAIL_FROM || 'Roadtripeado <noreply@roadtripeado.com>',
    resend_api_key: process.env.RESEND_API_KEY,
  },
  cloudinary: {
    cloudinary_name: process.env.CLOUDINARY_NAME,
    cloudinary_api_key: process.env.CLOUDINARY_API_KEY,
    cloudinary_secret: process.env.CLOUDINARY_SECRET,
  },
  super_admin: {
    name: process.env.SUPER_ADMIN_NAME,
    email: process.env.SUPER_ADMIN_EMAIL,
    password: process.env.SUPER_ADMIN_PASSWORD,
  },
  stripe: {
    stripeSecretKey: process.env.STRIPE_API_SECRET,
    webhookSecret: process.env.WEBHOOK_SECRET,
    paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET,
  },
}
