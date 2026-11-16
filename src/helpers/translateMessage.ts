/**
 * Senior-level translation dictionary and smart translator for API success & error messages.
 * Features:
 * - Direct exact & case-insensitive dictionary lookup
 * - Grammatically accurate Spanish gender ('m'/'f') and number (singular/plural) agreement
 * - Trailing punctuation preservation
 * - Safe fallback for non-string, missing, or custom messages
 */

interface IEntityInfo {
  es: string
  gender: 'm' | 'f'
  plural?: boolean
}

const entityMap: Record<string, IEntityInfo> = {
  place: { es: 'Lugar', gender: 'm' },
  places: { es: 'Lugares', gender: 'm', plural: true },
  map: { es: 'Mapa', gender: 'm' },
  maps: { es: 'Mapas', gender: 'm', plural: true },
  category: { es: 'Categoría', gender: 'f' },
  categories: { es: 'Categorías', gender: 'f', plural: true },
  business: { es: 'Negocio', gender: 'm' },
  businesses: { es: 'Negocios', gender: 'm', plural: true },
  offer: { es: 'Oferta', gender: 'f' },
  offers: { es: 'Ofertas', gender: 'f', plural: true },
  user: { es: 'Usuario', gender: 'm' },
  users: { es: 'Usuarios', gender: 'm', plural: true },
  profile: { es: 'Perfil', gender: 'm' },
  review: { es: 'Reseña', gender: 'f' },
  reviews: { es: 'Reseñas', gender: 'f', plural: true },
  support: { es: 'Soporte', gender: 'm' },
  supports: { es: 'Solicitudes de soporte', gender: 'f', plural: true },
  subscription: { es: 'Suscripción', gender: 'f' },
  subscriptions: { es: 'Suscripciones', gender: 'f', plural: true },
  'subscription plan': { es: 'Plan de suscripción', gender: 'm' },
  'subscription plans': { es: 'Planes de suscripción', gender: 'm', plural: true },
  award: { es: 'Premio', gender: 'm' },
  awards: { es: 'Premios', gender: 'm', plural: true },
  'award config': { es: 'Configuración de premio', gender: 'f' },
  'award configuration': { es: 'Configuración de premio', gender: 'f' },
  'award configs': { es: 'Configuraciones de premios', gender: 'f', plural: true },
  'award configurations': { es: 'Configuraciones de premios', gender: 'f', plural: true },
  faq: { es: 'Pregunta frecuente', gender: 'f' },
  faqs: { es: 'Preguntas frecuentes', gender: 'f', plural: true },
  notification: { es: 'Notificación', gender: 'f' },
  notifications: { es: 'Notificaciones', gender: 'f', plural: true },
  password: { es: 'Contraseña', gender: 'f' },
  comment: { es: 'Comentario', gender: 'm' },
  comments: { es: 'Comentarios', gender: 'm', plural: true },
  item: { es: 'Elemento', gender: 'm' },
  items: { es: 'Elementos', gender: 'm', plural: true },
  image: { es: 'Imagen', gender: 'f' },
  images: { es: 'Imágenes', gender: 'f', plural: true },
  document: { es: 'Documento', gender: 'm' },
  documents: { es: 'Documentos', gender: 'm', plural: true },
  'route plan': { es: 'Plan de ruta', gender: 'm' },
  'route plans': { es: 'Planes de ruta', gender: 'm', plural: true },
  route: { es: 'Ruta', gender: 'f' },
  routes: { es: 'Rutas', gender: 'f', plural: true },
  stop: { es: 'Parada', gender: 'f' },
  stops: { es: 'Paradas', gender: 'f', plural: true },
}


const exactMessageMap: Record<string, { en: string; es: string }> = {
  'an account with this email already exists. please log in or use another email': {
    en: 'An account with this email already exists. Please log in or use another email',
    es: 'Ya existe una cuenta con este correo. Inicia sesión o usa otro correo',
  },
  'this account has been deleted. please contact support or use another email': {
    en: 'This account has been deleted. Please contact support or use another email',
    es: 'Esta cuenta ha sido eliminada. Contacta con soporte o usa otro correo',
  },
  'your account is inactive. please contact support': {
    en: 'Your account is inactive. Please contact support',
    es: 'Tu cuenta está inactiva. Contacta con soporte',
  },
  'a record with these details already exists. please use different details': {
    en: 'A record with these details already exists. Please use different details',
    es: 'Ya existe un registro con estos datos. Usa datos diferentes',
  },
  'no account found with this email. please check it or create an account': {
    en: 'No account found with this email. Please check it or create an account',
    es: 'No encontramos una cuenta con este correo. Compruébalo o crea una cuenta',
  },
  'no account found with this phone. please check it or create an account': {
    en: 'No account found with this phone. Please check it or create an account',
    es: 'No encontramos una cuenta con este teléfono. Compruébalo o crea una cuenta',
  },
  // Authentication & Authorization
  'you are not authorized': {
    en: 'You are not authorized',
    es: 'No tienes autorización para realizar esta acción',
  },
  'password is incorrect': {
    en: 'Password is incorrect',
    es: 'La contraseña es incorrecta',
  },
  'invalid credentials': {
    en: 'Invalid credentials',
    es: 'Credenciales inválidas',
  },
  'account is blocked': {
    en: 'Account is blocked',
    es: 'La cuenta está bloqueada',
  },
  'account is deleted': {
    en: 'Account is deleted',
    es: 'La cuenta ha sido eliminada',
  },
  'token has expired': {
    en: 'Token has expired',
    es: 'El token ha expirado',
  },
  'invalid token': {
    en: 'Invalid token',
    es: 'Token no válido',
  },
  'user login successfully': {
    en: 'User login successfully',
    es: 'Inicio de sesión exitoso',
  },
  'user registered successfully': {
    en: 'User registered successfully',
    es: 'Usuario registrado exitosamente',
  },
  'password reset successfully': {
    en: 'Password reset successfully',
    es: 'Contraseña restablecida exitosamente',
  },
  'password changed successfully': {
    en: 'Password changed successfully',
    es: 'Contraseña cambiada exitosamente',
  },

  // Generic System & Errors
  'something went wrong!': {
    en: 'Something went wrong!',
    es: '¡Algo salió mal!',
  },
  'internal server error': {
    en: 'Internal server error',
    es: 'Error interno del servidor',
  },
  'validation error': {
    en: 'Validation error',
    es: 'Error de validación',
  },
  'failed to get presigned url': {
    en: 'Failed to get presigned URL',
    es: 'Error al obtener la URL prefirmada',
  },
  'presigned url generated': {
    en: 'Presigned URL generated',
    es: 'URL prefirmada generada exitosamente',
  },
  'this profile is private': {
    en: 'This profile is private',
    es: 'Este perfil es privado',
  },
  'failed to update profile': {
    en: 'Failed to update profile',
    es: 'Error al actualizar el perfil',
  },
  'failed to delete profile': {
    en: 'Failed to delete profile',
    es: 'Error al eliminar el perfil',
  },
  'failed to delete user': {
    en: 'Failed to delete user',
    es: 'Error al eliminar el usuario',
  },
  'failed to invite user': {
    en: 'Failed to invite user',
    es: 'Error al invitar al usuario',
  },
  'failed to update user status': {
    en: 'Failed to update user status',
    es: 'Error al actualizar el estado del usuario',
  },
  'failed to update user role': {
    en: 'Failed to update user role',
    es: 'Error al actualizar el rol del usuario',
  },

  // Places
  'place created successfully': {
    en: 'Place created successfully',
    es: 'Lugar creado exitosamente',
  },
  'place updated successfully': {
    en: 'Place updated successfully',
    es: 'Lugar actualizado exitosamente',
  },
  'place deleted successfully': {
    en: 'Place deleted successfully',
    es: 'Lugar eliminado exitosamente',
  },
  'place retrieved successfully': {
    en: 'Place retrieved successfully',
    es: 'Lugar obtenido exitosamente',
  },
  'places retrieved successfully': {
    en: 'Places retrieved successfully',
    es: 'Lugares obtenidos exitosamente',
  },
  'place not found': {
    en: 'Place not found',
    es: 'Lugar no encontrado',
  },
  'place open recorded': {
    en: 'Place open recorded',
    es: 'Apertura de lugar registrada exitosamente',
  },

  // Route Plans
  'route plan created successfully': {
    en: 'Route plan created successfully',
    es: 'Plan de ruta creado exitosamente',
  },
  'route plan updated successfully': {
    en: 'Route plan updated successfully',
    es: 'Plan de ruta actualizado exitosamente',
  },
  'route plan deleted successfully': {
    en: 'Route plan deleted successfully',
    es: 'Plan de ruta eliminado exitosamente',
  },
  'route plan retrieved successfully': {
    en: 'Route plan retrieved successfully',
    es: 'Plan de ruta obtenido exitosamente',
  },
  'route plans retrieved successfully': {
    en: 'Route plans retrieved successfully',
    es: 'Planes de ruta obtenidos exitosamente',
  },
  'route plan not found': {
    en: 'Route plan not found',
    es: 'Plan de ruta no encontrado',
  },
  'route stops cleared successfully': {
    en: 'Route stops cleared successfully',
    es: 'Paradas de la ruta limpiadas exitosamente',
  },
  'stop added to route successfully': {
    en: 'Stop added to route successfully',
    es: 'Parada añadida a la ruta exitosamente',
  },
  'stop removed from route successfully': {
    en: 'Stop removed from route successfully',
    es: 'Parada eliminada de la ruta exitosamente',
  },

  // Maps & Discovery
  'map created successfully': {
    en: 'Map created successfully',
    es: 'Mapa creado exitosamente',
  },
  'map updated successfully': {
    en: 'Map updated successfully',
    es: 'Mapa actualizado exitosamente',
  },
  'map deleted successfully': {
    en: 'Map deleted successfully',
    es: 'Mapa eliminado exitosamente',
  },
  'map retrieved successfully': {
    en: 'Map retrieved successfully',
    es: 'Mapa obtenido exitosamente',
  },
  'maps retrieved successfully': {
    en: 'Maps retrieved successfully',
    es: 'Mapas obtenidos exitosamente',
  },
  'map not found': {
    en: 'Map not found',
    es: 'Mapa no encontrado',
  },
  'map purchased successfully': {
    en: 'Map purchased successfully',
    es: 'Mapa comprado exitosamente',
  },
  'purchased maps retrieved successfully': {
    en: 'Purchased maps retrieved successfully',
    es: 'Mapas comprados obtenidos exitosamente',
  },
  'discovery data retrieved successfully': {
    en: 'Discovery data retrieved successfully',
    es: 'Datos de descubrimiento obtenidos exitosamente',
  },
  'available countries retrieved successfully': {
    en: 'Available countries retrieved successfully',
    es: 'Países disponibles obtenidos exitosamente',
  },
  'map view recorded': {
    en: 'Map view recorded',
    es: 'Visualización de mapa registrada exitosamente',
  },
  'toggle favorite map successfully': {
    en: 'Toggle favorite map successfully',
    es: 'Mapa favorito actualizado exitosamente',
  },
  'favorite maps retrieved successfully': {
    en: 'Favorite maps retrieved successfully',
    es: 'Mapas favoritos obtenidos exitosamente',
  },

  // Categories
  'category created successfully': {
    en: 'Category created successfully',
    es: 'Categoría creada exitosamente',
  },
  'category updated successfully': {
    en: 'Category updated successfully',
    es: 'Categoría actualizada exitosamente',
  },
  'category deleted successfully': {
    en: 'Category deleted successfully',
    es: 'Categoría eliminada exitosamente',
  },
  'category retrieved successfully': {
    en: 'Category retrieved successfully',
    es: 'Categoría obtenida exitosamente',
  },
  'categories retrieved successfully': {
    en: 'Categories retrieved successfully',
    es: 'Categorías obtenidas exitosamente',
  },
  'category not found': {
    en: 'Category not found',
    es: 'Categoría no encontrada',
  },

  // Business
  'business registered successfully': {
    en: 'Business registered successfully',
    es: 'Negocio registrado exitosamente',
  },
  'business created successfully': {
    en: 'Business created successfully',
    es: 'Negocio creado exitosamente',
  },
  'business updated successfully': {
    en: 'Business updated successfully',
    es: 'Negocio actualizado exitosamente',
  },
  'business deleted successfully': {
    en: 'Business deleted successfully',
    es: 'Negocio eliminado exitosamente',
  },
  'business retrieved successfully': {
    en: 'Business retrieved successfully',
    es: 'Negocio obtenido exitosamente',
  },
  'businesses retrieved successfully': {
    en: 'Businesses retrieved successfully',
    es: 'Negocios obtenidos exitosamente',
  },
  'business not found': {
    en: 'Business not found',
    es: 'Negocio no encontrado',
  },
  'business profile visit recorded': {
    en: 'Business profile visit recorded',
    es: 'Visita al perfil del negocio registrada exitosamente',
  },

  // Offers
  'offer created successfully': {
    en: 'Offer created successfully',
    es: 'Oferta creada exitosamente',
  },
  'offer updated successfully': {
    en: 'Offer updated successfully',
    es: 'Oferta actualizada exitosamente',
  },
  'offer deleted successfully': {
    en: 'Offer deleted successfully',
    es: 'Oferta eliminada exitosamente',
  },
  'offer retrieved successfully': {
    en: 'Offer retrieved successfully',
    es: 'Oferta obtenida exitosamente',
  },
  'offers retrieved successfully': {
    en: 'Offers retrieved successfully',
    es: 'Ofertas obtenidas exitosamente',
  },
  'offer not found': {
    en: 'Offer not found',
    es: 'Oferta no encontrada',
  },
  'offer redeemed successfully': {
    en: 'Offer redeemed successfully',
    es: 'Oferta canjeada exitosamente',
  },
  'favorite offers retrieved successfully': {
    en: 'Favorite offers retrieved successfully',
    es: 'Ofertas favoritas obtenidas exitosamente',
  },

  // Subscriptions & Plans
  'subscription plans retrieved successfully': {
    en: 'Subscription plans retrieved successfully',
    es: 'Planes de suscripción obtenidos exitosamente',
  },
  'subscription plan retrieved successfully': {
    en: 'Subscription plan retrieved successfully',
    es: 'Plan de suscripción obtenido exitosamente',
  },
  'subscription plan created successfully': {
    en: 'Subscription plan created successfully',
    es: 'Plan de suscripción creado exitosamente',
  },
  'subscription plan updated successfully': {
    en: 'Subscription plan updated successfully',
    es: 'Plan de suscripción actualizado exitosamente',
  },
  'subscription plan deleted successfully': {
    en: 'Subscription plan deleted successfully',
    es: 'Plan de suscripción eliminado exitosamente',
  },
  'all subscription plans retrieved successfully': {
    en: 'All subscription plans retrieved successfully',
    es: 'Todos los planes de suscripción obtenidos exitosamente',
  },
  'all subscriptions retrieved successfully': {
    en: 'All subscriptions retrieved successfully',
    es: 'Todas las suscripciones obtenidas exitosamente',
  },
  'subscription created successfully': {
    en: 'Subscription created successfully',
    es: 'Suscripción creada exitosamente',
  },
  'subscription updated successfully': {
    en: 'Subscription updated successfully',
    es: 'Suscripción actualizada exitosamente',
  },
  'subscription canceled successfully': {
    en: 'Subscription canceled successfully',
    es: 'Suscripción cancelada exitosamente',
  },
  'subscription paused successfully': {
    en: 'Subscription paused successfully',
    es: 'Suscripción pausada exitosamente',
  },
  'subscription resumed successfully': {
    en: 'Subscription resumed successfully',
    es: 'Suscripción reanudada exitosamente',
  },
  'subscription reactivated successfully': {
    en: 'Subscription reactivated successfully',
    es: 'Suscripción reactivada exitosamente',
  },
  'subscription status retrieved successfully': {
    en: 'Subscription status retrieved successfully',
    es: 'Estado de suscripción obtenido exitosamente',
  },
  'subscription analytics retrieved successfully': {
    en: 'Subscription analytics retrieved successfully',
    es: 'Análisis de suscripción obtenidos exitosamente',
  },
  'trial eligibility checked successfully': {
    en: 'Trial eligibility checked successfully',
    es: 'Elegibilidad para prueba verificada exitosamente',
  },
  'checkout session created successfully': {
    en: 'Checkout session created successfully',
    es: 'Sesión de pago creada exitosamente',
  },
  'billing portal session created successfully': {
    en: 'Billing portal session created successfully',
    es: 'Sesión del portal de facturación creada exitosamente',
  },
  'payment retry initiated successfully': {
    en: 'Payment retry initiated successfully',
    es: 'Reintento de pago iniciado exitosamente',
  },
  'usage data retrieved successfully': {
    en: 'Usage data retrieved successfully',
    es: 'Datos de uso obtenidos exitosamente',
  },
  'usage warnings retrieved successfully': {
    en: 'Usage warnings retrieved successfully',
    es: 'Advertencias de uso obtenidas exitosamente',
  },

  // Awards
  'award configurations retrieved successfully': {
    en: 'Award configurations retrieved successfully',
    es: 'Configuraciones de premios obtenidas exitosamente',
  },
  'award configuration retrieved successfully': {
    en: 'Award configuration retrieved successfully',
    es: 'Configuración de premio obtenida exitosamente',
  },
  'award configuration created successfully': {
    en: 'Award configuration created successfully',
    es: 'Configuración de premio creada exitosamente',
  },
  'award configuration updated successfully': {
    en: 'Award configuration updated successfully',
    es: 'Configuración de premio actualizada exitosamente',
  },
  'award configuration deleted successfully': {
    en: 'Award configuration deleted successfully',
    es: 'Configuración de premio eliminada exitosamente',
  },
  'awards retrieved successfully': {
    en: 'Awards retrieved successfully',
    es: 'Premios obtenidos exitosamente',
  },

  // Users & Profiles
  'user retrieved successfully': {
    en: 'User retrieved successfully',
    es: 'Usuario obtenido exitosamente',
  },
  'users retrieved successfully': {
    en: 'Users retrieved successfully',
    es: 'Usuarios obtenidos exitosamente',
  },
  'user deleted successfully': {
    en: 'User deleted successfully',
    es: 'Usuario eliminado exitosamente',
  },
  'user profile deleted successfully': {
    en: 'User profile deleted successfully',
    es: 'Perfil de usuario eliminado exitosamente',
  },
  'profile updated successfully': {
    en: 'Profile updated successfully',
    es: 'Perfil actualizado exitosamente',
  },
  'user profile retrieved successfully': {
    en: 'User profile retrieved successfully',
    es: 'Perfil de usuario obtenido exitosamente',
  },
  'public profile retrieved successfully': {
    en: 'Public profile retrieved successfully',
    es: 'Perfil público obtenido exitosamente',
  },
  'user status updated successfully': {
    en: 'User status updated successfully',
    es: 'Estado de usuario actualizado exitosamente',
  },
  'user role updated successfully': {
    en: 'User role updated successfully',
    es: 'Rol de usuario actualizado exitosamente',
  },
  'user interest updated successfully': {
    en: 'User interest updated successfully',
    es: 'Intereses de usuario actualizados exitosamente',
  },
  'editor access assigned successfully': {
    en: 'Editor access assigned successfully',
    es: 'Acceso de editor asignado exitosamente',
  },
  'user not found': {
    en: 'User not found',
    es: 'Usuario no encontrado',
  },
  'profile not found': {
    en: 'Profile not found',
    es: 'Perfil no encontrado',
  },

  // Reviews
  'review created successfully': {
    en: 'Review created successfully',
    es: 'Reseña creada exitosamente',
  },
  'review updated successfully': {
    en: 'Review updated successfully',
    es: 'Reseña actualizada exitosamente',
  },
  'review deleted successfully': {
    en: 'Review deleted successfully',
    es: 'Reseña eliminada exitosamente',
  },
  'reviews retrieved successfully': {
    en: 'Reviews retrieved successfully',
    es: 'Reseñas obtenidas exitosamente',
  },
  'review not found': {
    en: 'Review not found',
    es: 'Reseña no encontrada',
  },

  // Support
  'support created successfully': {
    en: 'Support created successfully',
    es: 'Solicitud de soporte creada exitosamente',
  },
  'support updated successfully': {
    en: 'Support updated successfully',
    es: 'Solicitud de soporte actualizada exitosamente',
  },
  'support deleted successfully': {
    en: 'Support deleted successfully',
    es: 'Solicitud de soporte eliminada exitosamente',
  },
  'support retrieved successfully': {
    en: 'Support retrieved successfully',
    es: 'Solicitud de soporte obtenida exitosamente',
  },
  'supports retrieved successfully': {
    en: 'Supports retrieved successfully',
    es: 'Solicitudes de soporte obtenidas exitosamente',
  },
  'support not found': {
    en: 'Support not found',
    es: 'Solicitud de soporte no encontrada',
  },

  // Notifications
  'notifications retrieved successfully': {
    en: 'Notifications retrieved successfully',
    es: 'Notificaciones obtenidas exitosamente',
  },
  'notification marked as read': {
    en: 'Notification marked as read',
    es: 'Notificación marcada como leída',
  },
  'all notifications marked as read': {
    en: 'All notifications marked as read',
    es: 'Todas las notificaciones marcadas como leídas',
  },

  // Stats
  'dashboard data fetched successfully': {
    en: 'Dashboard data fetched successfully',
    es: 'Datos del panel obtenidos exitosamente',
  },
  'reports data fetched successfully': {
    en: 'Reports data fetched successfully',
    es: 'Datos de informes obtenidos exitosamente',
  },
}

const getSpanishSuffix = (
  entity?: IEntityInfo,
  action: 'created' | 'updated' | 'deleted' | 'retrieved' | 'notFound' = 'created',
): string => {
  const isF = entity?.gender === 'f'
  const isPlural = entity?.plural === true

  switch (action) {
    case 'created':
      return isPlural
        ? isF
          ? 'creadas exitosamente'
          : 'creados exitosamente'
        : isF
        ? 'creada exitosamente'
        : 'creado exitosamente'
    case 'updated':
      return isPlural
        ? isF
          ? 'actualizadas exitosamente'
          : 'actualizados exitosamente'
        : isF
        ? 'actualizada exitosamente'
        : 'actualizado exitosamente'
    case 'deleted':
      return isPlural
        ? isF
          ? 'eliminadas exitosamente'
          : 'eliminados exitosamente'
        : isF
        ? 'eliminada exitosamente'
        : 'eliminado exitosamente'
    case 'retrieved':
      return isPlural
        ? isF
          ? 'obtenidas exitosamente'
          : 'obtenidos exitosamente'
        : isF
        ? 'obtenida exitosamente'
        : 'obtenido exitosamente'
    case 'notFound':
      return isPlural
        ? isF
          ? 'no encontradas'
          : 'no encontrados'
        : isF
        ? 'no encontrada'
        : 'no encontrado'
  }
}

/**
 * Translates an API response message or error message to the target language ('en' | 'es').
 * Fail-safe: Returns original message if English is requested, if message is not a string,
 * or if no translation is found.
 */
export const translateMessage = (message?: any, lang: 'en' | 'es' = 'es'): any => {
  if (message === null || message === undefined) return message
  if (typeof message !== 'string') return message

  const trimmed = message.trim()
  if (!trimmed) return message

  const hasTrailingDot = trimmed.endsWith('.')
  const withoutDot = hasTrailingDot ? trimmed.slice(0, -1).trim() : trimmed
  const lowerWithoutDot = withoutDot.toLowerCase()

  // 1. If English requested: return normalized exact match or original
  if (lang === 'en') {
    const entry = exactMessageMap[lowerWithoutDot]
    if (entry) {
      return hasTrailingDot ? `${entry.en}.` : entry.en
    }
    return message
  }

  // 2. Spanish: Exact dictionary match (case-insensitive)
  if (exactMessageMap[lowerWithoutDot]) {
    const esText = exactMessageMap[lowerWithoutDot].es
    return hasTrailingDot ? `${esText}.` : esText
  }

  // 3. Smart Regex pattern matching with gender & number agreement
  // Pattern A: "X created successfully"
  const createdMatch = withoutDot.match(/^(.+?)\s+created\s+successfully$/i)
  if (createdMatch) {
    const rawEntity = createdMatch[1].trim().toLowerCase()
    const entity = entityMap[rawEntity]
    const esName = entity?.es || createdMatch[1].trim()
    const suffix = getSpanishSuffix(entity, 'created')
    const result = `${esName} ${suffix}`
    return hasTrailingDot ? `${result}.` : result
  }

  // Pattern B: "X updated successfully"
  const updatedMatch = withoutDot.match(/^(.+?)\s+updated\s+successfully$/i)
  if (updatedMatch) {
    const rawEntity = updatedMatch[1].trim().toLowerCase()
    const entity = entityMap[rawEntity]
    const esName = entity?.es || updatedMatch[1].trim()
    const suffix = getSpanishSuffix(entity, 'updated')
    const result = `${esName} ${suffix}`
    return hasTrailingDot ? `${result}.` : result
  }

  // Pattern C: "X deleted successfully"
  const deletedMatch = withoutDot.match(/^(.+?)\s+deleted\s+successfully$/i)
  if (deletedMatch) {
    const rawEntity = deletedMatch[1].trim().toLowerCase()
    const entity = entityMap[rawEntity]
    const esName = entity?.es || deletedMatch[1].trim()
    const suffix = getSpanishSuffix(entity, 'deleted')
    const result = `${esName} ${suffix}`
    return hasTrailingDot ? `${result}.` : result
  }

  // Pattern D: "X retrieved successfully"
  const retrievedMatch = withoutDot.match(/^(.+?)\s+retrieved\s+successfully$/i)
  if (retrievedMatch) {
    const rawEntity = retrievedMatch[1].trim().toLowerCase()
    const entity = entityMap[rawEntity]
    const esName = entity?.es || retrievedMatch[1].trim()
    const suffix = getSpanishSuffix(entity, 'retrieved')
    const result = `${esName} ${suffix}`
    return hasTrailingDot ? `${result}.` : result
  }

  // Pattern E: "X not found"
  const notFoundMatch = withoutDot.match(/^(.+?)\s+not\s+found$/i)
  if (notFoundMatch) {
    const rawEntity = notFoundMatch[1].trim().toLowerCase()
    const entity = entityMap[rawEntity]
    const esName = entity?.es || notFoundMatch[1].trim()
    const suffix = getSpanishSuffix(entity, 'notFound')
    const result = `${esName} ${suffix}`
    return hasTrailingDot ? `${result}.` : result
  }

  // Pattern F: "Invalid X ID"
  const invalidIdMatch = withoutDot.match(/^Invalid\s+(.+?)\s+ID$/i)
  if (invalidIdMatch) {
    const rawEntity = invalidIdMatch[1].trim().toLowerCase()
    const entity = entityMap[rawEntity]
    const esName = entity?.es || invalidIdMatch[1].trim()
    const result = `ID de ${esName.toLowerCase()} no válido`
    return hasTrailingDot ? `${result}.` : result
  }

  // 4. Default fallback: safely return original message
  return message
}
