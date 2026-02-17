import { Request, Response, NextFunction } from 'express'
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase'
import { User } from '@supabase/supabase-js'

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: User
      isAdmin?: boolean
    }
  }
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.substring(7)
}

/**
 * Middleware that requires authentication
 * Returns 401 if not authenticated
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth check if Supabase is not configured (development mode)
  if (!isSupabaseConfigured) {
    console.warn('⚠️  Auth check skipped - Supabase not configured')
    return next()
  }

  const token = extractBearerToken(req)

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
    })
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      })
    }

    // Attach user to request
    req.user = user

    // Check if user is admin
    const role = user.user_metadata?.role || user.app_metadata?.role
    req.isAdmin = role === 'admin'

    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
    })
  }
}

/**
 * Middleware that requires admin role
 * Returns 401 if not authenticated, 403 if not admin
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Skip auth check if Supabase is not configured (development mode)
  if (!isSupabaseConfigured) {
    console.warn('⚠️  Admin check skipped - Supabase not configured')
    return next()
  }

  const token = extractBearerToken(req)

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
    })
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      })
    }

    // Check if user is admin
    const role = user.user_metadata?.role || user.app_metadata?.role
    if (role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      })
    }

    // Attach user to request
    req.user = user
    req.isAdmin = true

    next()
  } catch (error) {
    console.error('Admin middleware error:', error)
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
    })
  }
}

/**
 * Optional auth middleware - attaches user if token is valid, but doesn't require it
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  if (!isSupabaseConfigured) {
    return next()
  }

  const token = extractBearerToken(req)

  if (!token) {
    return next()
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

    if (!error && user) {
      req.user = user
      const role = user.user_metadata?.role || user.app_metadata?.role
      req.isAdmin = role === 'admin'
    }

    next()
  } catch (error) {
    // Don't fail on optional auth errors
    next()
  }
}
