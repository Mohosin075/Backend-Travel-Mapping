import cors from 'cors'
import express, { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import path from 'path'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import passport from './modules/auth/passport.auth/config/passport'
import router from './routes'
import globalErrorHandler from './middleware/globalErrorHandler'
import config from './config'
import { SubscriptionController } from './modules/subscription/subscription.controller'
import { PaymentController } from './modules/payment/payment.controller'

const app = express()
const isProduction = config.node_env === 'production'

// Fail fast in production if JWT secret is missing/weak
if (isProduction && (!config.jwt.jwt_secret || config.jwt.jwt_secret === 'secret')) {
  throw new Error(
    'JWT_SECRET must be set to a strong value in production',
  )
}

if (isProduction) {
  // Trust proxy so secure cookies work behind reverse proxy / load balancer
  app.set('trust proxy', 1)
}

// -------------------- Middleware --------------------
// Stripe webhook must come before express.json()
app.post(
  '/api/v1/subscription/webhook',
  express.raw({ type: 'application/json' }),
  SubscriptionController.handleWebhook,
)

app.post(
  '/api/v1/payment/webhook',
  express.raw({ type: 'application/json' }),
  PaymentController.handleWebhook,
)

// Body parsers must come after webhook
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true, limit: '20mb' }))

// Session must come before passport
const sessionSecret = config.jwt.jwt_secret || (!isProduction ? 'dev-only-secret' : '')
if (!sessionSecret) {
  throw new Error('JWT_SECRET is required for session configuration')
}

app.use(
  session({
    name: 'roadtripeado.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction, // HTTPS-only cookies in production
      // lax is enough for same-site / top-level OAuth redirects; avoids cross-site cookie pitfalls
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  }),
)

// Initialize Passport
app.use(passport.initialize())
app.use(passport.session())

// CORS
app.use(
  cors({
    origin: config.cors_origins,
    credentials: true,
  }),
)

// Cookie parser
app.use(cookieParser())

// Language Parser Middleware
import { languageMiddleware } from './middleware/language'
app.use(languageMiddleware)

// Logging — only in development
import morgan from 'morgan'
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'))
}

// -------------------- Static Files --------------------
const staticImageOptions = {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  setHeaders: (res: Response, filePath: string) => {
    if (/\.(jpg|jpeg|png|webp|avif|gif|svg)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
    }
  },
}

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), staticImageOptions))
app.use('/images', express.static(path.join(process.cwd(), 'uploads/images'), staticImageOptions))
app.use('/media', express.static(path.join(process.cwd(), 'uploads/media'), staticImageOptions))
app.use(
  '/documents',
  express.static(path.join(process.cwd(), 'uploads/documents')),
)

// -------------------- API Routes --------------------

app.get('/', (req: Request, res: Response) => {
  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Welcome to the roadtripeado API! The server is running smoothly.',
    timestamp: new Date().toISOString(),
  })
})

app.use('/api/v1', router)

// -------------------- Privacy Policy --------------------
app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy-policy.html'))
})

// -------------------- Error Handling --------------------
app.use(globalErrorHandler)

// Handle not found routes
app.use((req: Request, res: Response) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    message: 'API route not found!',
    errorMessages: [
      {
        path: req.originalUrl,
        message: 'API route not found!',
      },
    ],
  })
})

export default app
