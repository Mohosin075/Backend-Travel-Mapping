"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const http_status_codes_1 = require("http-status-codes");
const path_1 = __importDefault(require("path"));
const express_session_1 = __importDefault(require("express-session"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const passport_1 = __importDefault(require("./modules/auth/passport.auth/config/passport"));
const routes_1 = __importDefault(require("./routes"));
const globalErrorHandler_1 = __importDefault(require("./middleware/globalErrorHandler"));
const config_1 = __importDefault(require("./config"));
const subscription_controller_1 = require("./modules/subscription/subscription.controller");
const payment_controller_1 = require("./modules/payment/payment.controller");
const app = (0, express_1.default)();
const isProduction = config_1.default.node_env === 'production';
// Fail fast in production if JWT secret is missing/weak
if (isProduction && (!config_1.default.jwt.jwt_secret || config_1.default.jwt.jwt_secret === 'secret')) {
    throw new Error('JWT_SECRET must be set to a strong value in production');
}
if (isProduction) {
    // Trust proxy so secure cookies work behind reverse proxy / load balancer
    app.set('trust proxy', 1);
}
// -------------------- Middleware --------------------
// Stripe webhook must come before express.json()
app.post('/api/v1/subscription/webhook', express_1.default.raw({ type: 'application/json' }), subscription_controller_1.SubscriptionController.handleWebhook);
app.post('/api/v1/payment/webhook', express_1.default.raw({ type: 'application/json' }), payment_controller_1.PaymentController.handleWebhook);
// Body parsers must come after webhook
app.use(express_1.default.json({ limit: '20mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '20mb' }));
// Session must come before passport
const sessionSecret = config_1.default.jwt.jwt_secret || (!isProduction ? 'dev-only-secret' : '');
if (!sessionSecret) {
    throw new Error('JWT_SECRET is required for session configuration');
}
app.use((0, express_session_1.default)({
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
}));
// Initialize Passport
app.use(passport_1.default.initialize());
app.use(passport_1.default.session());
// CORS
app.use((0, cors_1.default)({
    origin: config_1.default.cors_origins,
    credentials: true,
}));
// Cookie parser
app.use((0, cookie_parser_1.default)());
// Language Parser Middleware
const language_1 = require("./middleware/language");
app.use(language_1.languageMiddleware);
// Logging — only in development
const morgan_1 = __importDefault(require("morgan"));
if (process.env.NODE_ENV !== 'production') {
    app.use((0, morgan_1.default)('dev'));
}
// -------------------- Static Files --------------------
const staticImageOptions = {
    maxAge: '30d',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (/\.(jpg|jpeg|png|webp|avif|gif|svg)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        }
    },
};
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads'), staticImageOptions));
app.use('/images', express_1.default.static(path_1.default.join(process.cwd(), 'uploads/images'), staticImageOptions));
app.use('/media', express_1.default.static(path_1.default.join(process.cwd(), 'uploads/media'), staticImageOptions));
app.use('/documents', express_1.default.static(path_1.default.join(process.cwd(), 'uploads/documents')));
// -------------------- API Routes --------------------
app.get('/', (req, res) => {
    res.status(http_status_codes_1.StatusCodes.OK).json({
        success: true,
        message: 'Welcome to the API! The server is running smoothly.',
        timestamp: new Date().toISOString(),
    });
});
app.use('/api/v1', routes_1.default);
// -------------------- Privacy Policy --------------------
app.get('/privacy-policy', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, 'privacy-policy.html'));
});
// -------------------- Error Handling --------------------
app.use(globalErrorHandler_1.default);
// Handle not found routes
app.use((req, res) => {
    res.status(http_status_codes_1.StatusCodes.NOT_FOUND).json({
        success: false,
        message: 'API route not found!',
        errorMessages: [
            {
                path: req.originalUrl,
                message: 'API route not found!',
            },
        ],
    });
});
exports.default = app;
