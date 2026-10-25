"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserMapAccessSchema = exports.assignEditorAccessZodSchema = exports.favoriteOfferSchema = exports.favoritePlaceSchema = exports.favoriteMapSchema = exports.addUserInterestSchema = exports.updateUserRoleSchema = exports.inviteUserSchema = exports.createStaffSchema = exports.STAFF_SPECIALTY = exports.updateUserSchema = void 0;
const zod_1 = require("zod");
const user_1 = require("../../enum/user");
// ------------------ SUB-SCHEMAS ------------------
const addressSchema = zod_1.z.object({
    city: zod_1.z.string().optional(),
    postalCode: zod_1.z.string().optional(),
    country: zod_1.z.string().optional(),
    permanentAddress: zod_1.z.string().optional(),
    presentAddress: zod_1.z.string().optional(),
});
const authenticationSchema = zod_1.z.object({
    restrictionLeftAt: zod_1.z.date().nullable().optional(),
    resetPassword: zod_1.z.boolean().optional(),
    wrongLoginAttempts: zod_1.z.number().optional(),
    passwordChangedAt: zod_1.z.date().optional(),
    oneTimeCode: zod_1.z.string().optional(),
    latestRequestAt: zod_1.z.date().optional(),
    expiresAt: zod_1.z.date().optional(),
    requestCount: zod_1.z.number().optional(),
    authType: zod_1.z.enum(['createAccount', 'resetPassword']).optional(),
});
const pointSchema = zod_1.z.object({
    type: zod_1.z.literal('Point').default('Point'),
    coordinates: zod_1.z.tuple([zod_1.z.number(), zod_1.z.number()]).optional(), // [longitude, latitude]
});
const settingsSchema = zod_1.z.object({
    pushNotification: zod_1.z.boolean().optional(),
    emailNotification: zod_1.z.boolean().optional(),
    locationService: zod_1.z.boolean().optional(),
    weeklyReports: zod_1.z.boolean().optional(),
    profileStatus: zod_1.z.enum(['public', 'private']).optional(),
});
// ------------------ UPDATE USER VALIDATION ------------------
exports.updateUserSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().optional(),
        profile: zod_1.z.string().optional(),
        images: zod_1.z.union([zod_1.z.string(), zod_1.z.array(zod_1.z.string())]).optional(),
        phone: zod_1.z.string().optional(),
        website: zod_1.z.string().optional().or(zod_1.z.literal('')),
        instagram: zod_1.z.string().optional().or(zod_1.z.literal('')),
        description: zod_1.z.string().optional().or(zod_1.z.literal('')),
        city: zod_1.z.string().optional().or(zod_1.z.literal('')),
        profileStatus: zod_1.z.enum(['public', 'private']).optional(),
        specialty: zod_1.z.string().optional(),
        address: addressSchema.optional(),
        location: pointSchema.optional(),
        appId: zod_1.z.string().optional(),
        deviceToken: zod_1.z.string().optional(),
        settings: settingsSchema.optional(),
        // --- Cycle Tracking Fields ---
        lastPeriodStartDate: zod_1.z.string().datetime().optional(),
        cycleLength: zod_1.z.number().min(1).optional(),
        periodLength: zod_1.z.number().min(1).optional(),
        isAverageCycleLength: zod_1.z.boolean().optional(),
        isAveragePeriodLength: zod_1.z.boolean().optional(),
        dateOfBirth: zod_1.z.string().datetime().optional(),
        dietaryRestrictions: zod_1.z.array(zod_1.z.string()).optional(),
        isOnboardingComplete: zod_1.z.boolean().optional(),
    }),
});
exports.STAFF_SPECIALTY = zod_1.z.enum([
    'Cleaning',
    'Cooking',
    'Laundry',
    'Grocery',
    'Maintenance',
]);
exports.createStaffSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string({ required_error: 'Name is required' }),
        email: zod_1.z.string().email({ message: 'Invalid email address' }),
        specialties: zod_1.z
            .array(exports.STAFF_SPECIALTY, {
            required_error: 'At least one specialty is required',
        })
            .min(1, 'Select at least one specialty'),
        bio: zod_1.z.string().optional(),
    }),
});
exports.inviteUserSchema = zod_1.z.object({
    body: zod_1.z
        .object({
        email: zod_1.z.string().email({ message: 'Invalid email address' }),
        role: zod_1.z.nativeEnum(user_1.USER_ROLES),
        assignedMaps: zod_1.z.array(zod_1.z.string()).optional(),
        assignedCountries: zod_1.z.array(zod_1.z.string()).optional(),
    })
        .superRefine((data, ctx) => {
        var _a, _b, _c, _d;
        if (data.role === user_1.USER_ROLES.MAP_EDITOR) {
            const maps = (_b = (_a = data.assignedMaps) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
            const countries = (_d = (_c = data.assignedCountries) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0;
            if (maps === 0 && countries === 0) {
                ctx.addIssue({
                    code: zod_1.z.ZodIssueCode.custom,
                    message: 'Map Editor must be assigned at least one map or country.',
                    path: ['assignedMaps'],
                });
            }
        }
    }),
});
exports.updateUserRoleSchema = zod_1.z.object({
    params: zod_1.z.object({
        userId: zod_1.z.string({
            required_error: 'User ID is required',
        }),
    }),
    body: zod_1.z.object({
        role: zod_1.z.nativeEnum(user_1.USER_ROLES),
        assignedMaps: zod_1.z.array(zod_1.z.string()).optional(),
        assignedCountries: zod_1.z.array(zod_1.z.string()).optional(),
    }),
});
exports.addUserInterestSchema = zod_1.z.object({
    body: zod_1.z.object({
        interest: zod_1.z.array(zod_1.z.nativeEnum(user_1.InterestCategory)).optional(),
    }),
});
exports.favoriteMapSchema = zod_1.z.object({
    params: zod_1.z.object({
        mapId: zod_1.z.string({
            required_error: 'Map ID is required',
        }),
    }),
});
exports.favoritePlaceSchema = zod_1.z.object({
    params: zod_1.z.object({
        placeId: zod_1.z.string({
            required_error: 'Place ID is required',
        }),
    }),
});
exports.favoriteOfferSchema = zod_1.z.object({
    params: zod_1.z.object({
        offerId: zod_1.z.string({
            required_error: 'Offer ID is required',
        }),
    }),
});
exports.assignEditorAccessZodSchema = zod_1.z.object({
    params: zod_1.z.object({
        userId: zod_1.z.string({
            required_error: 'User ID is required',
        }),
    }),
    body: zod_1.z
        .object({
        assignedMaps: zod_1.z.array(zod_1.z.string()).optional(),
        assignedCountries: zod_1.z.array(zod_1.z.string()).optional(),
    })
        .superRefine((data, ctx) => {
        var _a, _b, _c, _d;
        const maps = (_b = (_a = data.assignedMaps) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
        const countries = (_d = (_c = data.assignedCountries) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0;
        // Only enforce when both fields are explicitly sent empty
        if (data.assignedMaps !== undefined &&
            data.assignedCountries !== undefined &&
            maps === 0 &&
            countries === 0) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Map Editor must be assigned at least one map or country.',
                path: ['assignedMaps'],
            });
        }
    }),
});
exports.updateUserMapAccessSchema = zod_1.z.object({
    params: zod_1.z.object({
        userId: zod_1.z.string({
            required_error: 'User ID is required',
        }),
    }),
    body: zod_1.z.object({
        mapId: zod_1.z.string({
            required_error: 'Map ID is required',
        }),
        action: zod_1.z.enum(['deactivate', 'reactivate', 'grant', 'remove'], {
            required_error: 'Action is required (deactivate, reactivate, grant, or remove)',
        }),
    }),
});
