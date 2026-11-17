"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromoServices = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = require("mongoose");
const http_status_codes_1 = require("http-status-codes");
const ApiError_1 = __importDefault(require("../../errors/ApiError"));
const config_1 = __importDefault(require("../../config"));
const stripe_1 = __importDefault(require("../../config/stripe"));
const emailHelper_1 = require("../../helpers/emailHelper");
const map_model_1 = require("../map/map.model");
const user_model_1 = require("../user/user.model");
const payment_model_1 = require("../payment/payment.model");
const promo_model_1 = require("./promo.model");
const server_1 = require("../../server");
const localize_1 = require("../../helpers/localize");
const user_1 = require("../../enum/user");
const payment_service_1 = require("../payment/payment.service");
const checkoutOrigin_1 = require("../../helpers/checkoutOrigin");
const validatePromoUser = (user, recipientEmail) => {
    var _a;
    if (!user || user.status !== user_1.USER_STATUS.ACTIVE) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'This account is not available. Please sign in with an active account.');
    }
    if (recipientEmail) {
        if (((_a = user.email) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase()) !== recipientEmail.trim().toLowerCase()) {
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, `This invitation is specifically reserved for ${recipientEmail}. Please sign in with that email.`);
        }
        if (!user.verified)
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.FORBIDDEN, 'Please verify your email before using this invitation.');
    }
};
const verifyPromoCode = async (code, userMapId) => {
    if (userMapId && !mongoose_1.Types.ObjectId.isValid(userMapId))
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid map ID');
    const promoLink = await promo_model_1.PromoLink.findOne({ code });
    if (!promoLink) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Promo link not found');
    }
    if (promoLink.isUsed) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This promo link has already been used');
    }
    if (promoLink.expiresAt && new Date(promoLink.expiresAt) < new Date()) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This promo link has expired');
    }
    // Resolve Map ID
    const mapId = promoLink.mapId || (userMapId ? new mongoose_1.Types.ObjectId(userMapId) : null);
    let mapName = 'Selected Map';
    if (mapId) {
        const map = await map_model_1.Map.findById(mapId).select('name');
        if (map) {
            mapName = (0, localize_1.localizeField)(map.name);
        }
    }
    return {
        ...promoLink.toObject(),
        mapName,
    };
};
const claimFreePromo = async (userId, code, userMapId) => {
    var _a;
    const promoDetails = await verifyPromoCode(code, userMapId);
    const user = await user_model_1.User.findById(userId);
    if (!user) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'User not found');
    }
    validatePromoUser(user, promoDetails.recipientEmail);
    if (promoDetails.price > 0) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This promo link requires payment and cannot be claimed for free');
    }
    const mapId = promoDetails.mapId || (userMapId ? new mongoose_1.Types.ObjectId(userMapId) : null);
    if (!mapId) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Please specify which map you want to claim');
    }
    const map = await map_model_1.Map.findById(mapId);
    if (!map) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Selected map not found');
    }
    if (!promoDetails.mapId && (map.status !== 'Published' || !map.isActive || !map.isPaid)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Please select an available premium map.');
    }
    if ((_a = user.purchasedMaps) === null || _a === void 0 ? void 0 : _a.some(id => String(id) === String(mapId))) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'You already own this map.');
    }
    const session = await promo_model_1.PromoLink.startSession();
    try {
        await session.withTransaction(async () => {
            // Claim and entitlement must commit together; failed access grants can retry.
            const updatedPromo = await promo_model_1.PromoLink.findOneAndUpdate({ code, isUsed: false, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }, { isUsed: true, usedBy: new mongoose_1.Types.ObjectId(userId), usedAt: new Date() }, { new: true, session });
            if (!updatedPromo) {
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Promo link was already claimed, expired, or invalid');
            }
            const updatedUser = await user_model_1.User.findOneAndUpdate({ _id: userId, status: user_1.USER_STATUS.ACTIVE }, {
                $addToSet: { purchasedMaps: mapId },
            }, { session, new: true });
            if (!updatedUser)
                throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'Account changed while claiming. Please try again.');
        });
    }
    finally {
        await session.endSession();
    }
    return {
        success: true,
        mapId: String(mapId),
        mapName: (0, localize_1.localizeField)(map.name),
        message: `Promo claimed successfully! ${(0, localize_1.localizeField)(map.name) || 'The map'} is now unlocked.`,
    };
};
const createPromoCheckoutSession = async (user, code, userMapId, origin) => {
    var _a, _b, _c, _d;
    const returnOrigin = (0, checkoutOrigin_1.getCheckoutReturnOrigin)(origin);
    const promoDetails = await verifyPromoCode(code, userMapId);
    const buyer = await user_model_1.User.findById(user.authId);
    validatePromoUser(buyer, promoDetails.recipientEmail);
    if (promoDetails.price <= 0) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'This promo link is free, please claim it directly instead of checkout');
    }
    const mapId = promoDetails.mapId || (userMapId ? new mongoose_1.Types.ObjectId(userMapId) : null);
    if (!mapId) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Please specify which map you want to unlock');
    }
    const map = await map_model_1.Map.findById(mapId);
    if (!map) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Selected map not found');
    }
    if (!promoDetails.mapId && (map.status !== 'Published' || !map.isActive || !map.isPaid)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Please select an available premium map.');
    }
    if ((_a = buyer.purchasedMaps) === null || _a === void 0 ? void 0 : _a.some(id => String(id) === String(mapId))) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'You already own this map.');
    }
    const amount = promoDetails.price;
    const currency = 'usd';
    await payment_model_1.Payment.init();
    const now = new Date();
    // A single-use promo must not create parallel chargeable sessions for
    // different accounts/maps. The same account resumes its existing checkout.
    if (promoDetails.checkoutSessionId) {
        const previous = await stripe_1.default.checkout.sessions.retrieve(promoDetails.checkoutSessionId);
        if (previous.payment_status === 'paid') {
            await payment_service_1.PaymentServices.verifyCheckoutSession(previous.id);
            throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'This invitation has already been paid. Open your purchased maps.');
        }
        if (promoDetails.checkoutExpiresAt && promoDetails.checkoutExpiresAt <= now && previous.status === 'open') {
            await stripe_1.default.checkout.sessions.expire(previous.id);
        }
    }
    let reservation = await promo_model_1.PromoLink.findOneAndUpdate({ code, isUsed: false,
        $and: [
            { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
            { $or: [{ checkoutReservationId: null }, { checkoutExpiresAt: { $lte: now } }] },
        ],
    }, { $set: { checkoutReservationId: crypto_1.default.randomBytes(16).toString('hex'),
            checkoutUserId: buyer._id, checkoutMapId: mapId,
            checkoutReturnOrigin: returnOrigin,
            checkoutExpiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 23 * 60 * 60 * 1000) },
        $unset: { checkoutSessionId: 1 } }, { new: true }).lean();
    if (!reservation)
        reservation = await promo_model_1.PromoLink.findOne({ code, isUsed: false,
            checkoutUserId: buyer._id, checkoutMapId: mapId, checkoutExpiresAt: { $gt: now } }).lean();
    if (!reservation)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'This invitation is already in checkout. Please retry after the current checkout expires.');
    if (reservation.checkoutReturnOrigin && reservation.checkoutReturnOrigin !== returnOrigin) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.CONFLICT, 'Continue this checkout on the website where it was started.');
    }
    if (reservation.checkoutSessionId) {
        const previous = await stripe_1.default.checkout.sessions.retrieve(reservation.checkoutSessionId);
        return { sessionId: previous.id, url: previous.url || `${returnOrigin}/claim-promo?code=${encodeURIComponent(code)}&mapId=${mapId}&success=true&session_id=${previous.id}` };
    }
    const session = await stripe_1.default.checkout.sessions.create({
        ...(((_b = config_1.default.stripe) === null || _b === void 0 ? void 0 : _b.automaticTaxEnabled) ? {
            automatic_tax: { enabled: true },
            billing_address_collection: 'required',
        } : {}),
        expires_at: Math.floor(reservation.checkoutExpiresAt.getTime() / 1000),
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    ...(((_c = config_1.default.stripe) === null || _c === void 0 ? void 0 : _c.automaticTaxEnabled) ? { tax_behavior: 'exclusive' } : {}),
                    currency,
                    product_data: {
                        ...(((_d = config_1.default.stripe) === null || _d === void 0 ? void 0 : _d.automaticTaxEnabled) && config_1.default.stripe.taxCode ? { tax_code: config_1.default.stripe.taxCode } : {}),
                        name: `Map Upgrade: ${typeof map.name === 'object' ? map.name.en || map.name.es : map.name}`,
                        description: `Exclusive discounted upgrade for ${typeof map.name === 'object' ? map.name.en || map.name.es : map.name}`,
                    },
                    unit_amount: Math.round(amount * 100),
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: `${returnOrigin}/claim-promo?code=${encodeURIComponent(code)}&mapId=${mapId}&success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnOrigin}/claim-promo?code=${encodeURIComponent(code)}&mapId=${mapId}&cancelled=true`,
        customer_email: buyer.email,
        metadata: {
            type: 'promo_payment',
            promoCode: code,
            userId: user.authId.toString(),
            mapId: mapId.toString(),
        },
    }, { idempotencyKey: `promo-${reservation.checkoutReservationId}` });
    await payment_model_1.Payment.updateOne({ promoCheckoutKey: reservation.checkoutReservationId }, { $setOnInsert: {
            promoCheckoutKey: reservation.checkoutReservationId,
            userId: user.authId,
            mapId: mapId,
            userEmail: buyer.email,
            amount,
            currency: currency.toUpperCase(),
            paymentMethod: 'stripe',
            paymentIntentId: session.id, // Store session ID for verify mapping
            status: 'pending',
            metadata: {
                type: 'promo_payment',
                promoCode: code,
                checkoutSessionId: session.id,
                mapId: mapId.toString(),
            },
        } }, { upsert: true }).catch(async (error) => {
        if (error.code !== 11000 || !await payment_model_1.Payment.findOne({ promoCheckoutKey: reservation.checkoutReservationId }))
            throw error;
    });
    await promo_model_1.PromoLink.updateOne({ code, checkoutReservationId: reservation.checkoutReservationId }, { $set: { checkoutSessionId: session.id } });
    return {
        sessionId: session.id,
        url: session.url,
    };
};
const verifyPromoPayment = async (userId, code, sessionId) => {
    var _a;
    validatePromoUser(await user_model_1.User.findById(userId));
    const query = { userId, 'metadata.promoCode': code, status: { $ne: 'refunded' } };
    if (sessionId)
        query['metadata.checkoutSessionId'] = sessionId;
    const payment = await payment_model_1.Payment.findOne(query).sort({ createdAt: -1 });
    if (!payment)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'No payment found for this invitation and account.');
    const checkoutId = (_a = payment.metadata) === null || _a === void 0 ? void 0 : _a.checkoutSessionId;
    if (!checkoutId)
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Checkout reference is missing. Please contact support.');
    const result = await payment_service_1.PaymentServices.verifyCheckoutSession(checkoutId);
    if (result.status !== 'succeeded')
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Payment has not completed. Please retry verification after payment.');
    return { mapId: String(payment.mapId) };
};
const bulkGeneratePromoLinks = async (payload) => {
    const { mapId, price, promoType, label, emails, count, expiresAt } = payload;
    const promoLinksData = [];
    const expiration = expiresAt ? new Date(expiresAt) : null;
    const resolvedType = promoType || (price === 0 ? 'influencer' : 'upgrade');
    if (emails && emails.length > 0) {
        for (const email of emails) {
            const code = crypto_1.default.randomBytes(8).toString('hex').toUpperCase();
            promoLinksData.push({
                code,
                mapId: mapId ? new mongoose_1.Types.ObjectId(mapId) : null,
                price,
                promoType: resolvedType,
                label,
                recipientEmail: email.trim().toLowerCase(),
                isEmailSent: false,
                isUsed: false,
                expiresAt: expiration,
            });
        }
    }
    else {
        const limit = count || 1;
        for (let i = 0; i < limit; i++) {
            const code = crypto_1.default.randomBytes(8).toString('hex').toUpperCase();
            promoLinksData.push({
                code,
                mapId: mapId ? new mongoose_1.Types.ObjectId(mapId) : null,
                price,
                promoType: resolvedType,
                label,
                recipientEmail: null,
                isEmailSent: false,
                isUsed: false,
                expiresAt: expiration,
            });
        }
    }
    const generatedLinks = (await promo_model_1.PromoLink.insertMany(promoLinksData));
    return generatedLinks;
};
const sendBulkPromoEmails = async (promoIds) => {
    const promoLinks = await promo_model_1.PromoLink.find({
        _id: { $in: promoIds },
        isUsed: false,
        recipientEmail: { $ne: null },
        isEmailSent: { $ne: true },
    }).populate('mapId', 'name');
    if (promoLinks.length === 0) {
        return {
            message: 'No valid pending links with recipient emails found to process',
        };
    }
    // Trigger background email sending to prevent blocking Node event loop
    processEmailsInBackground(promoLinks);
    return {
        message: `Started sending emails to ${promoLinks.length} recipients in the background.`,
    };
};
const processEmailsInBackground = async (promoLinks) => {
    console.log(`Starting background bulk email job for ${promoLinks.length} recipients.`);
    // Send 10 emails every 2 seconds to avoid hitting SMTP rate limits
    const BATCH_SIZE = 10;
    const DELAY_MS = 2000;
    for (let i = 0; i < promoLinks.length; i += BATCH_SIZE) {
        const batch = promoLinks.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (promo) => {
            var _a;
            try {
                const localizedName = (0, localize_1.localizeField)((_a = promo.mapId) === null || _a === void 0 ? void 0 : _a.name, 'es');
                const mapName = typeof localizedName === 'string' && localizedName.trim()
                    ? localizedName.trim()
                    : 'mapa exclusivo';
                const safeMapName = mapName.replace(/[&<>"']/g, char => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
                })[char]);
                const claimUrl = `${config_1.default.clientUrl}/claim-promo?code=${promo.code}`;
                let subject = '';
                let bodyText = '';
                let buttonText = 'Acceder al mapa';
                if (promo.promoType === 'influencer') {
                    subject = `Invitación de acceso VIP exclusivo - ${mapName}`;
                    bodyText = `<p>¡Estamos encantados de extenderte una invitación especial! Como influencer clave, tienes acceso VIP 100% gratuito a la versión premium de Roadtripeado.</p>
               <p>Canjea tu pase de invitado ahora haciendo clic en el enlace a continuación e iniciando sesión o registrándote:</p>`;
                }
                else if (promo.promoType === 'upgrade') {
                    subject = `¡Roadtripeado evolucionó! 🚀 Migra a la nueva plataforma - ${mapName}`;
                    buttonText = '¡Migra a la nueva plataforma aquí!';
                    const discountText = promo.price === 5 ? 'un 85% de descuento' : 'un precio especial';
                    bodyText = `<p>¡Roadtripeado evolucionó! 🚀 Creamos una plataforma completamente nueva que reemplaza nuestro mapa anterior, con un diseño moderno, nuevas herramientas y sin las limitaciones de Google Maps.</p>
               <p>Como ya compraste nuestro mapa, tienes ${discountText} para migrar a la nueva plataforma por solo $${promo.price} (pago único). No estás comprando otro mapa, sino actualizando tu acceso a una experiencia completamente renovada.</p>
               <p>Para migrar, solo tienes que registrarte y completar el proceso.</p>`;
                }
                else {
                    subject = `Oferta especial de mapas: ${mapName}`;
                    bodyText = `<p>¡Hola!</p>
               <p>¡Hemos creado una oferta especial para ti en Roadtripeado! Puedes desbloquear el mapa <strong>${safeMapName}</strong> por un precio especial de solo <strong>$${promo.price}</strong>.</p>
               <p>Para canjear esta oferta, haz clic en el enlace de abajo e inicia sesión o crea una cuenta con el correo que recibió esta invitación:</p>`;
                }
                const emailHtml = `
            <body lang="es" style="margin:0; padding:0; background-color:#F9FAFB; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB; padding: 40px 0;">
                <tr>
                  <td align="center">
                    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.05); border: 1px solid #E5E7EB;">
                      <tr>
                        <td style="padding: 40px 40px 20px 40px; text-align:center;">
                          <div style="margin-bottom: 24px;">
                             <img src="cid:roadtripeado-logo" alt="Roadtripeado Logo" style="width:140px; height:auto; display:block; margin:0 auto;" />
                          </div>
                          <h1 style="color:#111827; font-size:24px; font-weight:700; margin:0; line-height: 1.2;">Tu enlace de acceso exclusivo</h1>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 0 40px 40px 40px; text-align:center;">
                          ${bodyText}
                          <div style="margin: 32px 0;">
                            <a href="${claimUrl}" style="display:inline-block; background-color:#FFC107; color:#000000; padding:16px 40px; border-radius:10px; text-decoration:none; font-weight:700; font-size:16px; box-shadow: 0 4px 6px rgba(255, 193, 7, 0.2);">${buttonText}</a>
                          </div>
                          <p style="color:#777777; font-size:13px; margin: 24px 0 0 0;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
                          <p style="word-break: break-all; font-size:12px; color:#FFC107;"><a href="${claimUrl}" style="color:#FFC107; text-decoration:underline;">${claimUrl}</a></p>
                        </td>
                      </tr>
                      <tr>
                        <td style="background:#F9FAFB; padding:24px; text-align:center; font-size:12px; color:#6B7280;">&copy; ${new Date().getFullYear()} Roadtripeado. Todos los derechos reservados.</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
          `;
                const emailResult = await emailHelper_1.emailHelper.sendEmail({
                    to: promo.recipientEmail,
                    subject,
                    html: emailHtml,
                });
                if (!emailResult.success) {
                    throw new Error('Failed to deliver promo invitation email');
                }
                await promo_model_1.PromoLink.findByIdAndUpdate(promo._id, {
                    isEmailSent: true,
                    emailSentAt: new Date(),
                });
                if (server_1.io) {
                    server_1.io.emit('promo_email_sent', {
                        promoId: promo._id,
                        recipientEmail: promo.recipientEmail,
                        isEmailSent: true,
                        emailSentAt: new Date(),
                    });
                }
                console.log(`Successfully sent promo email to: ${promo.recipientEmail} for code: ${promo.code}`);
            }
            catch (err) {
                console.error(`Failed to send bulk promo email to: ${promo.recipientEmail}`, err);
            }
        }));
        // Wait between batches to prevent spam/throttling
        if (i + BATCH_SIZE < promoLinks.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }
    if (server_1.io) {
        server_1.io.emit('promo_bulk_sent_complete', {
            totalSent: promoLinks.length,
        });
    }
    console.log(`Background bulk email job completed.`);
};
const getAllPromoLinks = async (query) => {
    const { page = 1, limit = 10, searchTerm = '', isUsed, mapId, promoType } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = {};
    if (searchTerm) {
        filter.$or = [
            { code: { $regex: searchTerm, $options: 'i' } },
            { label: { $regex: searchTerm, $options: 'i' } },
            { recipientEmail: { $regex: searchTerm, $options: 'i' } },
        ];
    }
    if (isUsed !== undefined && isUsed !== '') {
        filter.isUsed = isUsed === 'true';
    }
    if (mapId) {
        filter.mapId = new mongoose_1.Types.ObjectId(mapId);
    }
    if (promoType) {
        filter.promoType = promoType;
    }
    const [data, total] = await Promise.all([
        promo_model_1.PromoLink.find(filter)
            .populate('mapId', 'name')
            .populate('usedBy', 'name email')
            .skip(skip)
            .limit(Number(limit))
            .sort({ createdAt: -1 }),
        promo_model_1.PromoLink.countDocuments(filter),
    ]);
    return {
        meta: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
        },
        data,
    };
};
const deletePromoLink = async (id) => {
    if (!mongoose_1.Types.ObjectId.isValid(id)) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.BAD_REQUEST, 'Invalid promo link ID');
    }
    const result = await promo_model_1.PromoLink.findByIdAndDelete(id);
    if (!result) {
        throw new ApiError_1.default(http_status_codes_1.StatusCodes.NOT_FOUND, 'Promo link not found');
    }
    return result;
};
const getPromoStats = async () => {
    const [total, used, unused, influencer, upgrade, emailSent, pendingEmail] = await Promise.all([
        promo_model_1.PromoLink.countDocuments(),
        promo_model_1.PromoLink.countDocuments({ isUsed: true }),
        promo_model_1.PromoLink.countDocuments({ isUsed: false }),
        promo_model_1.PromoLink.countDocuments({ promoType: 'influencer' }),
        promo_model_1.PromoLink.countDocuments({ promoType: 'upgrade' }),
        promo_model_1.PromoLink.countDocuments({ isEmailSent: true }),
        promo_model_1.PromoLink.countDocuments({ isUsed: false, recipientEmail: { $ne: null }, $or: [{ isEmailSent: false }, { isEmailSent: { $exists: false } }] }),
    ]);
    return {
        total,
        used,
        unused,
        influencer,
        upgrade,
        emailSent,
        pendingEmail,
    };
};
exports.PromoServices = {
    verifyPromoPayment,
    verifyPromoCode,
    claimFreePromo,
    createPromoCheckoutSession,
    bulkGeneratePromoLinks,
    sendBulkPromoEmails,
    getAllPromoLinks,
    deletePromoLink,
    getPromoStats,
};
