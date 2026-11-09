import passport from 'passport'
import { User } from '../../../user/user.model'
import { Strategy as LocalStrategy } from 'passport-local'
import { USER_ROLES, USER_STATUS } from '../../../../enum/user'

import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import config from '../../../../config'
import ApiError from '../../../../errors/ApiError'
import { StatusCodes } from 'http-status-codes'

passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true,
    },
    async (req, email, password, done) => {
      try {
        const isUserExist = await User.findOne({
          email: email.trim().toLowerCase(),
          status: { $in: [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE] },
        })
          .select('+password +authentication')
          .lean()

        if (!isUserExist) {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'No account found with this email, please try with valid email or create an account.',
          )
        }

        return done(null, {
          ...isUserExist,
        })
      } catch (err) {
        return done(err)
      }
    },
  ),
)

passport.use(
  new GoogleStrategy(
    {
      clientID: config.google.client_id!,
      clientSecret: config.google.client_secret!,
      callbackURL: config.google.callback_url,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      req.body.profile = profile
      req.body.role = USER_ROLES.USER

      try {
        return done(null, req.body)
      } catch (err) {
        return done(err)
      }
    },
  ),
)

// Serialize the user
passport.serializeUser((data: any, done) => {
  // If we have a DB user, store the _id; otherwise, store the whole object for social-only login
  if (data.user?._id) {
    done(null, { type: 'db', id: data.user._id.toString() })
  } else {
    done(null, { type: 'social', data }) // store social-only info
  }
})

// Deserialize the user
passport.deserializeUser(async (payload: any, done) => {
  try {
    if (!payload) return done(null, null)

    if (payload.type === 'db') {
      // Fetch DB user by _id
      const user = await User.findById(payload.id).select('email name role')
      return done(null, user || null)
    } else if (payload.type === 'social') {
      // Social-only user, just return stored data
      return done(null, payload.data)
    }

    return done(null, null)
  } catch (err) {
    done(err, null)
  }
})

export default passport
