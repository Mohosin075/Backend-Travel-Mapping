import { z } from 'zod'
import { InterestCategory, USER_ROLES, USER_STATUS } from '../../enum/user'

// ------------------ SUB-SCHEMAS ------------------
const addressSchema = z.object({
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  permanentAddress: z.string().optional(),
  presentAddress: z.string().optional(),
})

const authenticationSchema = z.object({
  restrictionLeftAt: z.date().nullable().optional(),
  resetPassword: z.boolean().optional(),
  wrongLoginAttempts: z.number().optional(),
  passwordChangedAt: z.date().optional(),
  oneTimeCode: z.string().optional(),
  latestRequestAt: z.date().optional(),
  expiresAt: z.date().optional(),
  requestCount: z.number().optional(),
  authType: z.enum(['createAccount', 'resetPassword']).optional(),
})

const pointSchema = z.object({
  type: z.literal('Point').default('Point'),
  coordinates: z.tuple([z.number(), z.number()]).optional(), // [longitude, latitude]
})

const settingsSchema = z.object({
  pushNotification: z.boolean().optional(),
  emailNotification: z.boolean().optional(),
  locationService: z.boolean().optional(),
  weeklyReports: z.boolean().optional(),
  profileStatus: z.enum(['public', 'private']).optional(),
})

// ------------------ UPDATE USER VALIDATION ------------------
export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    profile: z.string().optional(),
    images: z.union([z.string(), z.array(z.string())]).optional(),
    phone: z.string().optional(),
    website: z.string().optional().or(z.literal('')),
    instagram: z.string().optional().or(z.literal('')),
    description: z.string().optional().or(z.literal('')),
    city: z.string().optional().or(z.literal('')),
    profileStatus: z.enum(['public', 'private']).optional(),
    specialty: z.string().optional(),

    address: addressSchema.optional(),
    location: pointSchema.optional(),

    appId: z.string().optional(),
    deviceToken: z.string().optional(),

    settings: settingsSchema.optional(),

    // --- Cycle Tracking Fields ---
    lastPeriodStartDate: z.string().datetime().optional(),
    cycleLength: z.number().min(1).optional(),
    periodLength: z.number().min(1).optional(),
    isAverageCycleLength: z.boolean().optional(),
    isAveragePeriodLength: z.boolean().optional(),
    dateOfBirth: z.string().datetime().optional(),
    dietaryRestrictions: z.array(z.string()).optional(),
    isOnboardingComplete: z.boolean().optional(),
  }),
})

export const STAFF_SPECIALTY = z.enum([
  'Cleaning',
  'Cooking',
  'Laundry',
  'Grocery',
  'Maintenance',
])

export const createStaffSchema = z.object({
  body: z.object({
    name: z.string({ required_error: 'Name is required' }),
    email: z.string().email({ message: 'Invalid email address' }),
    specialties: z
      .array(STAFF_SPECIALTY, {
        required_error: 'At least one specialty is required',
      })
      .min(1, 'Select at least one specialty'),
    bio: z.string().optional(),
  }),
})

export const inviteUserSchema = z.object({
  body: z
    .object({
      email: z.string().email({ message: 'Invalid email address' }),
      role: z.nativeEnum(USER_ROLES),
      assignedMaps: z.array(z.string()).optional(),
      assignedCountries: z.array(z.string()).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.role === USER_ROLES.MAP_EDITOR) {
        const maps = data.assignedMaps?.length ?? 0
        const countries = data.assignedCountries?.length ?? 0
        if (maps === 0 && countries === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Map Editor must be assigned at least one map or country.',
            path: ['assignedMaps'],
          })
        }
      }
    }),
})

export const updateUserRoleSchema = z.object({
  params: z.object({
    userId: z.string({
      required_error: 'User ID is required',
    }),
  }),
  body: z.object({
    role: z.nativeEnum(USER_ROLES),
    assignedMaps: z.array(z.string()).optional(),
    assignedCountries: z.array(z.string()).optional(),
  }),
})

export const addUserInterestSchema = z.object({
  body: z.object({
    interest: z.array(z.nativeEnum(InterestCategory)).optional(),
  }),
})

export const favoriteMapSchema = z.object({
  params: z.object({
    mapId: z.string({
      required_error: 'Map ID is required',
    }),
  }),
})

export const favoritePlaceSchema = z.object({
  params: z.object({
    placeId: z.string({
      required_error: 'Place ID is required',
    }),
  }),
})

export const favoriteOfferSchema = z.object({
  params: z.object({
    offerId: z.string({
      required_error: 'Offer ID is required',
    }),
  }),
})

export const assignEditorAccessZodSchema = z.object({
  params: z.object({
    userId: z.string({
      required_error: 'User ID is required',
    }),
  }),
  body: z
    .object({
      assignedMaps: z.array(z.string()).optional(),
      assignedCountries: z.array(z.string()).optional(),
    })
    .superRefine((data, ctx) => {
      const maps = data.assignedMaps?.length ?? 0
      const countries = data.assignedCountries?.length ?? 0
      // Only enforce when both fields are explicitly sent empty
      if (
        data.assignedMaps !== undefined &&
        data.assignedCountries !== undefined &&
        maps === 0 &&
        countries === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Map Editor must be assigned at least one map or country.',
          path: ['assignedMaps'],
        })
      }
    }),
})

export const updateUserMapAccessSchema = z.object({
  params: z.object({
    userId: z.string({
      required_error: 'User ID is required',
    }),
  }),
  body: z.object({
    mapId: z.string({
      required_error: 'Map ID is required',
    }),
    action: z.enum(['deactivate', 'reactivate', 'grant', 'remove'], {
      required_error: 'Action is required (deactivate, reactivate, grant, or remove)',
    }),
  }),
})

