import config from '../config'
import { ICreateAccount, IResetPassword } from '../interfaces/emailTemplate'

const formatRoleSpanish = (role: string): string => {
  const normalized = (role || '').toLowerCase().replace(/[\s-]+/g, '_')
  switch (normalized) {
    case 'map_editor':
      return 'Editor de Mapas'
    case 'admin':
      return 'Administrador'
    case 'super_admin':
      return 'Super Administrador'
    case 'business':
      return 'Negocio'
    default:
      return 'Usuario'
  }
}

const createAccount = (values: ICreateAccount) => {
  return {
    to: values.email,
    subject: `Verifica tu cuenta, ${values.name}`,
    html: `
      <body style="margin:0; padding:0; background-color:#F9FAFB; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB; padding: 40px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.05); border: 1px solid #E5E7EB;">
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align:center;">
                    <div style="margin-bottom: 24px;">
                       <img src="cid:roadtripeado-logo" alt="Roadtripeado Logo" style="width:140px; height:auto; display:block; margin:0 auto;" />
                    </div>
                    <h1 style="color:#111827; font-size:28px; font-weight:700; margin:0; line-height: 1.2;">Verifica Tu Cuenta</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px 40px 40px; text-align:center;">
                    <p style="color:#4B5563; font-size:16px; line-height:1.6; margin:0 0 24px;">Hola ${values.name}, utiliza el código que aparece a continuación para verificar tu cuenta.</p>
                    <div style="background-color:#F3F4F6; border-radius:12px; padding: 32px; margin-bottom: 32px; border: 1px dashed #D1D5DB;">
                      <p style="color:#6B7280; font-size:14px; text-transform:uppercase; letter-spacing:1px; font-weight:600; margin:0 0 16px;">Código de Verificación</p>
                      <div style="font-size:42px; font-weight:800; color:#FFC107; letter-spacing:8px; margin:0;">${values.otp}</div>
                    </div>
                    <p style="color:#777777; font-size:14px; margin:0 0 32px;">Este código vence en 5 minutos. Si no realizaste esta solicitud, puedes ignorar este correo.</p>
                    <div style="margin-bottom: 32px;">
                      <a href="${config.clientUrl}/otp-verify?email=${encodeURIComponent(values.email)}&authType=createAccount" style="display:inline-block; background-color:#FFC107; color:#000000; padding:16px 40px; border-radius:10px; text-decoration:none; font-weight:700; font-size:16px; box-shadow: 0 4px 6px rgba(255, 193, 7, 0.2);">Verificar Ahora</a>
                    </div>
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
    `,
  }
}

const resetPassword = (values: IResetPassword) => {
  const heading = values.isSetup ? 'Verifica tu email' : 'Restablecer Contraseña'
  const action = values.isSetup ? 'Verificar email' : 'Restablecer Contraseña'
  return {
    to: values.email,
    subject: values.isSetup ? 'Verifica tu email para crear tu contraseña' : `Restablece tu contraseña, ${values.name}`,
    html: `
      <body style="margin:0; padding:0; background-color:#F9FAFB; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB; padding: 40px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.05); border: 1px solid #E5E7EB;">
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align:center;">
                    <div style="margin-bottom: 24px;">
                       <img src="cid:roadtripeado-logo" alt="Roadtripeado Logo" style="width:140px; height:auto; display:block; margin:0 auto;" />
                    </div>
                    <h1 style="color:#111827; font-size:28px; font-weight:700; margin:0; line-height: 1.2;">${heading}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px 40px 40px; text-align:center;">
                    <p style="color:#4B5563; font-size:16px; line-height:1.6; margin:0 0 24px;">Hola ${values.name}, utiliza el código que aparece a continuación para ${values.isSetup ? 'verificar tu email y crear tu contraseña' : 'restablecer tu contraseña'}.</p>
                    <div style="background-color:#F3F4F6; border-radius:12px; padding: 32px; margin-bottom: 32px; border: 1px dashed #D1D5DB;">
                      <p style="color:#6B7280; font-size:14px; text-transform:uppercase; letter-spacing:1px; font-weight:600; margin:0 0 16px;">${values.isSetup ? 'Código de Verificación' : 'Código de Restablecimiento'}</p>
                      <div style="font-size:42px; font-weight:800; color:#FFC107; letter-spacing:8px; margin:0;">${values.otp}</div>
                    </div>
                    <p style="color:#777777; font-size:14px; margin:0 0 32px;">Este código vence en 5 minutos. Si no realizaste esta solicitud, puedes ignorar este correo.</p>
                    <div style="margin-bottom: 32px;">
                      <a href="${config.clientUrl}/otp-verify?email=${encodeURIComponent(values.email)}&authType=${values.isSetup ? 'setPassword' : 'resetPassword'}" style="display:inline-block; background-color:#FFC107; color:#000000; padding:16px 40px; border-radius:10px; text-decoration:none; font-weight:700; font-size:16px; box-shadow: 0 4px 6px rgba(255, 193, 7, 0.2);">${action}</a>
                    </div>
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
    `,
  }
}

const resendOtp = (values: {
  email: string
  name: string
  otp: string
  type: 'resetPassword' | 'createAccount' | 'setPassword'
}) => {
  const isReset = values.type === 'resetPassword'
  return {
    to: values.email,
    subject: `${isReset ? 'Restablecimiento de Contraseña' : 'Verificación de Cuenta'} - Nuevo Código`,
    html: `
      <body style="margin:0; padding:0; background-color:#F9FAFB; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB; padding: 40px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.05); border: 1px solid #E5E7EB;">
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align:center;">
                    <div style="margin-bottom: 24px;">
                       <img src="cid:roadtripeado-logo" alt="Roadtripeado Logo" style="width:140px; height:auto; display:block; margin:0 auto;" />
                    </div>
                    <h1 style="color:#111827; font-size:28px; font-weight:700; margin:0; line-height: 1.2;">Nuevo Código de ${isReset ? 'Restablecimiento' : 'Verificación'}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px 40px 40px; text-align:center;">
                    <p style="color:#4B5563; font-size:16px; line-height:1.6; margin:0 0 24px;">Hola ${values.name}, has solicitado un nuevo código de ${isReset ? 'restablecimiento de contraseña' : 'verificación'}.</p>
                    <div style="background-color:#F3F4F6; border-radius:12px; padding: 32px; margin-bottom: 32px; border: 1px dashed #D1D5DB;">
                      <p style="color:#6B7280; font-size:14px; text-transform:uppercase; letter-spacing:1px; font-weight:600; margin:0 0 16px;">Nuevo Código</p>
                      <div style="font-size:42px; font-weight:800; color:#FFC107; letter-spacing:8px; margin:0;">${values.otp}</div>
                    </div>
                    <p style="color:#777777; font-size:14px; margin:0 0 32px;">Este código vence en 5 minutos. Por favor, no compartas este código con nadie.</p>
                    <div style="margin-bottom: 8px;">
                      <a href="${config.clientUrl}/otp-verify?email=${encodeURIComponent(values.email)}&authType=${values.type}" style="display:inline-block; background-color:#FFC107; color:#000000; padding:16px 40px; border-radius:10px; text-decoration:none; font-weight:700; font-size:16px; box-shadow: 0 4px 6px rgba(255, 193, 7, 0.2);">${isReset ? 'Restablecer Contraseña' : 'Verificar Ahora'}</a>
                    </div>
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
    `,
  }
}

const subscriptionWelcome = (values: {
  name: string
  email: string
  planName: string
  planPrice: number
  planInterval: string
  isTrialing: boolean
  trialDays?: number
  trialEndDate?: Date
  features: string[]
  dashboardUrl: string
}) => {
  return {
    to: values.email,
    subject: `¡Bienvenido al Plan ${values.planName}!`,
    html: `
      <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 20px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
                <tr>
                  <td style="padding: 30px; text-align:center; background:#2980b9;">
                    <h1 style="color:#ffffff; font-size:26px; margin:0;">Bienvenido a ${values.planName}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px;">
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Hola ${values.name},</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">¡Gracias por suscribirte a nuestro plan <strong>${values.planName}</strong>!</p>
                    
                    ${
                      values.isTrialing
                        ? `
                    <div style="background:#e8f4fd; padding:20px; border-radius:8px; margin-bottom:20px;">
                      <p style="color:#2980b9; font-weight:bold; margin:0 0 10px;">¡Tu prueba gratuita ha comenzado!</p>
                      <p style="color:#555555; margin:0;">Tienes ${values.trialDays} días para explorar todas las funciones. Tu prueba finaliza el ${values.trialEndDate?.toLocaleDateString('es-ES')}.</p>
                    </div>
                    `
                        : ''
                    }

                    <p style="color:#2c3e50; font-size:18px; font-weight:bold; margin:0 0 15px;">Detalles del Plan:</p>
                    <ul style="color:#555555; font-size:15px; line-height:1.6; margin:0 0 30px;">
                      <li><strong>Plan:</strong> ${values.planName}</li>
                      <li><strong>Precio:</strong> $${values.planPrice}/${values.planInterval}</li>
                    </ul>

                    <p style="color:#2c3e50; font-size:18px; font-weight:bold; margin:0 0 15px;">Funciones Incluidas:</p>
                    <ul style="color:#555555; font-size:15px; line-height:1.6; margin:0 0 30px;">
                      ${values.features.map(f => `<li>${f}</li>`).join('')}
                    </ul>

                    <div style="text-align:center;">
                      <a href="${values.dashboardUrl}" style="display:inline-block; background:#2980b9; color:#ffffff; padding:15px 30px; border-radius:8px; text-decoration:none; font-weight:bold;">Ir al Panel</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    `,
  }
}

const trialEnding = (values: {
  name: string
  email: string
  planName: string
  trialEndDate: Date
  daysLeft: number
  planPrice: number
  planInterval: string
  upgradeUrl: string
}) => {
  return {
    to: values.email,
    subject: `¡Tu prueba gratuita de ${values.planName} está por terminar!`,
    html: `
      <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 20px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
                <tr>
                  <td style="padding: 30px; text-align:center; background:#e67e22;">
                    <h1 style="color:#ffffff; font-size:26px; margin:0;">Tu Prueba Termina Pronto</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px;">
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Hola ${values.name},</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Tu prueba gratuita del plan <strong>${values.planName}</strong> finalizará en <strong>${values.daysLeft} días</strong> (el ${values.trialEndDate.toLocaleDateString('es-ES')}).</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 30px;">Para garantizar el acceso ininterrumpido a todas las funciones, actualiza a una suscripción de pago antes de que venza tu prueba.</p>
                    <div style="text-align:center;">
                      <a href="${values.upgradeUrl}" style="display:inline-block; background:#e67e22; color:#ffffff; padding:15px 30px; border-radius:8px; text-decoration:none; font-weight:bold;">Actualizar Ahora</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    `,
  }
}

const paymentSuccess = (values: {
  name: string
  email: string
  invoiceNumber: string
  amount: number | string
  currency: string
  paymentDate: Date
  nextPaymentDate: Date
  invoiceUrl?: string
  dashboardUrl: string
}) => {
  return {
    to: values.email,
    subject: `Pago Exitoso - Factura ${values.invoiceNumber}`,
    html: `
      <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 20px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
                <tr>
                  <td style="padding: 30px; text-align:center; background:#27ae60;">
                    <h1 style="color:#ffffff; font-size:26px; margin:0;">Pago Exitoso</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px;">
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Hola ${values.name},</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Hemos procesado exitosamente tu pago de <strong>${values.currency.toUpperCase()} ${values.amount}</strong>.</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;"><strong>Factura:</strong> ${values.invoiceNumber}</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;"><strong>Fecha:</strong> ${values.paymentDate.toLocaleDateString('es-ES')}</p>
                    ${
                      values.invoiceUrl
                        ? `
                    <div style="text-align:center; margin-top:30px;">
                      <a href="${values.invoiceUrl}" style="display:inline-block; background:#27ae60; color:#ffffff; padding:15px 30px; border-radius:8px; text-decoration:none; font-weight:bold;">Ver Factura</a>
                    </div>
                    `
                        : ''
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    `,
  }
}

const paymentFailed = (values: {
  name: string
  email: string
  planName: string
  amount: number | string
  currency: string
  failureReason: string
  retryDate: Date
  updatePaymentUrl: string
  dashboardUrl: string
}) => {
  return {
    to: values.email,
    subject: `Pago Fallido - Acción Requerida`,
    html: `
      <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 20px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
                <tr>
                  <td style="padding: 30px; text-align:center; background:#c0392b;">
                    <h1 style="color:#ffffff; font-size:26px; margin:0;">Pago Fallido</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px;">
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Hola ${values.name},</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">No pudimos procesar tu pago de <strong>${values.currency.toUpperCase()} ${values.amount}</strong> correspondiente a tu suscripción.</p>
                    <p style="color:#c0392b; font-weight:bold; margin:0 0 20px;">Motivo: ${values.failureReason}</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 30px;">Intentaremos procesar el pago nuevamente el ${values.retryDate.toLocaleDateString('es-ES')}. Por favor actualiza tu método de pago para evitar la interrupción del servicio.</p>
                    <div style="text-align:center;">
                      <a href="${values.updatePaymentUrl}" style="display:inline-block; background:#c0392b; color:#ffffff; padding:15px 30px; border-radius:8px; text-decoration:none; font-weight:bold;">Actualizar Método de Pago</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    `,
  }
}

const subscriptionCanceled = (values: {
  name: string
  email: string
  planName: string
  canceledAt: Date
  accessUntil: Date
  feedbackUrl: string
  reactivateUrl: string
}) => {
  return {
    to: values.email,
    subject: `Suscripción Cancelada - ${values.planName}`,
    html: `
      <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 20px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
                <tr>
                  <td style="padding: 30px; text-align:center; background:#7f8c8d;">
                    <h1 style="color:#ffffff; font-size:26px; margin:0;">Suscripción Cancelada</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px;">
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Hola ${values.name},</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Tu suscripción a <strong>${values.planName}</strong> ha sido cancelada.</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Continuarás teniendo acceso hasta el <strong>${values.accessUntil.toLocaleDateString('es-ES')}</strong>.</p>
                    <div style="text-align:center; margin-top:30px;">
                      <a href="${values.reactivateUrl}" style="display:inline-block; background:#2980b9; color:#ffffff; padding:15px 30px; border-radius:8px; text-decoration:none; font-weight:bold;">Reactivar Suscripción</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    `,
  }
}

const planChange = (values: {
  name: string
  email: string
  newPlanName: string
  newPlanPrice: number
  planInterval: string
  isUpgrade: boolean
  priceDifference: number
  prorationNote: string
  features: string[]
  dashboardUrl: string
  billingUrl: string
}) => {
  return {
    to: values.email,
    subject: `Tu plan se ha actualizado a ${values.newPlanName}`,
    html: `
      <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: Arial, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding: 20px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
                <tr>
                  <td style="padding: 30px; text-align:center; background:#8e44ad;">
                    <h1 style="color:#ffffff; font-size:26px; margin:0;">Plan Actualizado</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px;">
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Hola ${values.name},</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">Tu suscripción se ha actualizado al plan <strong>${values.newPlanName}</strong>.</p>
                    <p style="color:#555555; font-size:16px; margin:0 0 20px;">${values.prorationNote}</p>
                    <div style="text-align:center; margin-top:30px;">
                      <a href="${values.dashboardUrl}" style="display:inline-block; background:#8e44ad; color:#ffffff; padding:15px 30px; border-radius:8px; text-decoration:none; font-weight:bold;">Ir al Panel</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    `,
  }
}

const userInvitation = (values: { email: string; role: string; otp: string }) => {
  const roleName = formatRoleSpanish(values.role)
  return {
    to: values.email,
    subject: `Has sido invitado a unirte como ${roleName}`,
    html: `
      <body style="margin:0; padding:0; background-color:#F9FAFB; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB; padding: 40px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 25px rgba(0,0,0,0.05); border: 1px solid #E5E7EB;">
                <!-- Header with Logo -->
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align:center;">
                    <div style="margin-bottom: 24px;">
                       <img src="cid:roadtripeado-logo" alt="Roadtripeado Logo" style="width:140px; height:auto; display:block; margin:0 auto;" />
                    </div>
                    <h1 style="color:#111827; font-size:28px; font-weight:700; margin:0; line-height: 1.2;">Invitación para Unirte</h1>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 0 40px 40px 40px; text-align:center;">
                    <p style="color:#4B5563; font-size:16px; line-height:1.6; margin:0 0 24px;">
                      Has sido invitado a unirte a nuestra plataforma como <strong style="color:#111827;">${roleName}</strong>.
                    </p>
                    
                    <div style="background-color:#F3F4F6; border-radius:12px; padding: 32px; margin-bottom: 32px; border: 1px dashed #D1D5DB;">
                      <p style="color:#6B7280; font-size:14px; text-transform:uppercase; letter-spacing:1px; font-weight:600; margin:0 0 16px;">Tu Código de Invitación</p>
                      <div style="font-size:42px; font-weight:800; color:#FFC107; letter-spacing:8px; margin:0;">${values.otp}</div>
                    </div>
                    
                    <p style="color:#4B5563; font-size:15px; line-height:1.6; margin:0 0 32px;">
                      Ingresa el código anterior en la siguiente pantalla y luego establece tu contraseña para unirte.
                      Si has recibido más de una invitación, utiliza únicamente el código más <strong>reciente</strong>.
                    </p>
                    
                    <!-- CTA Button -->
                    <div style="margin-bottom: 32px;">
                      <a href="${config.clientUrl}/otp-verify?email=${encodeURIComponent(values.email)}&authType=invite" target="_blank" style="display:inline-block; background-color:#FFC107; color:#000000; padding:16px 40px; border-radius:10px; text-decoration:none; font-weight:700; font-size:16px; box-shadow: 0 4px 6px rgba(255, 193, 7, 0.2); transition: all 0.3s ease;">
                        Aceptar Invitación
                      </a>
                    </div>
                    
                    <p style="color:#9CA3AF; font-size:13px; line-height:1.5; margin:0; border-top: 1px solid #F3F4F6; padding-top: 24px;">
                      Este código de invitación vencerá en 24 horas. Los códigos anteriores dejan de funcionar cuando se envía una nueva invitación.<br>
                      Si no esperabas esta invitación, puedes ignorar este correo electrónico.
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background:#F9FAFB; padding:24px; text-align:center; font-size:12px; color:#6B7280;">
                    &copy; ${new Date().getFullYear()} Roadtripeado. Todos los derechos reservados.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    `,
  }
}

export const emailTemplate = {
  createAccount,
  resetPassword,
  resendOtp,
  subscriptionWelcome,
  trialEnding,
  paymentSuccess,
  paymentFailed,
  subscriptionCanceled,
  planChange,
  userInvitation,
}
