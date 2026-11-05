import { Resend } from 'resend'
import { StatusCodes } from 'http-status-codes'
import config from '../../config'
import ApiError from '../../errors/ApiError'
import { EmailNotificationData } from './notification.interface'
import { EmailTemplates } from './notification.templates'

export class EmailProvider {
  private resend: Resend
  private static instance: EmailProvider

  private constructor() {
    this.resend = new Resend(config.email.resend_api_key)
  }

  static getInstance(): EmailProvider {
    if (!EmailProvider.instance) {
      EmailProvider.instance = new EmailProvider()
    }
    return EmailProvider.instance
  }

  private getSenderEmail(): string {
    const defaultFrom = 'Roadtripeado <noreply@roadtripeado.com>'
    const configuredFrom = config.email.from

    if (!configuredFrom) {
      return defaultFrom
    }

    if (configuredFrom.includes('@gmail.com') || !configuredFrom.includes('@')) {
      return defaultFrom
    }

    return configuredFrom
  }

  private async verifyConnection(): Promise<void> {
    try {
      const { error } = await this.resend.domains.list()
      if (error) {
        throw new Error(error.message)
      }
      console.log('✅ Resend email service verified')
    } catch (error: any) {
      console.error('❌ Resend email service verification failed:', error.message)
      throw new ApiError(
        StatusCodes.SERVICE_UNAVAILABLE,
        'Email service is currently unavailable',
      )
    }
  }

  async sendEmail(data: EmailNotificationData): Promise<boolean> {
    try {
      const { subject, html } = EmailTemplates.getTemplate(
        data.template,
        data.data,
      )

      const from = this.getSenderEmail()
      const recipients = Array.isArray(data.to)
        ? data.to
        : data.to.split(',').map((email) => email.trim()).filter(Boolean)

      const { data: result, error } = await this.resend.emails.send({
        from,
        to: recipients,
        subject,
        html,
        attachments: data.attachments as any,
      })

      if (error) {
        console.error('❌ Resend email sending failed:', error.message)
        throw new ApiError(
          StatusCodes.INTERNAL_SERVER_ERROR,
          `Failed to send email: ${error.message}`,
        )
      }

      console.log(`📧 Email sent via Resend: ${result?.id}`)

      return true
    } catch (error: any) {
      console.error('❌ Email sending failed:', error.message)
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Failed to send email: ${error.message}`,
      )
    }
  }

  async sendBulkEmails(
    emails: EmailNotificationData[],
  ): Promise<{ success: number; failed: number }> {
    const results = {
      success: 0,
      failed: 0,
    }

    for (const emailData of emails) {
      try {
        await this.sendEmail(emailData)
        results.success++
      } catch (error) {
        console.error(`Failed to send email to: ${emailData.to}:`, error)
        results.failed++
      }
    }

    console.log(
      `📧 Bulk email sending completed: ${results.success} succeeded, ${results.failed} failed`,
    )
    return results
  }

  async sendTemplateEmail(
    to: string | string[],
    template: string,
    templateData: Record<string, any>,
    subjectOverride?: string,
  ): Promise<boolean> {
    const data: EmailNotificationData = {
      to,
      subject: subjectOverride || '',
      template,
      data: templateData,
    }

    return this.sendEmail(data)
  }

  async sendWelcomeEmail(to: string, userName: string): Promise<boolean> {
    return this.sendTemplateEmail(to, 'welcome', {
      userName,
      actionUrl: `${config.clientUrl}/dashboard`,
      actionText: 'Ir al Panel de Control',
    })
  }

  async sendPasswordReset(
    to: string,
    resetCode: string,
    userName: string,
  ): Promise<boolean> {
    return this.sendTemplateEmail(to, 'password-reset', {
      userName,
      resetCode,
      expiryMinutes: 30,
      actionUrl: `${config.clientUrl}/reset-password?code=${resetCode}`,
      actionText: 'Restablecer Contraseña',
    })
  }

  async sendAccountVerification(
    to: string,
    userName: string,
    verificationToken: string,
  ): Promise<boolean> {
    const verificationUrl = `${config.clientUrl}/verify-email?token=${verificationToken}`

    return this.sendTemplateEmail(to, 'account-verification', {
      userName,
      verificationUrl,
      actionUrl: verificationUrl,
      actionText: 'Verificar Cuenta',
    })
  }
}

export const emailProvider = EmailProvider.getInstance()
