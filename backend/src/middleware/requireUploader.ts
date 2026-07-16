/**
 * 「可管理项目」权限 —— 单一真相源,服务端强制。
 *
 * 谁能上传楼书 / 增删改项目 / 管理任务,只由这三条决定(任一即可):
 *   1. isAdminEmail  —— admin 白名单(owner + Shell),见 lib/adminEmails.ts
 *   2. isOwnerEmail  —— owner 白名单,见 middleware/requireOwner.ts
 *   3. upload_permissions 表白名单 —— 我们手动 grant 的账号(付费方也走手动 grant)
 *
 * 刻意**不看套餐/角色**。付 $999 的开发商也由人工加进 upload_permissions,
 * 而不是靠 role='developer'+订阅 自动放行(会被直连 API 绕过 / 卡积分误伤白名单)。
 */
import { Request, Response, NextFunction, RequestHandler } from 'express'
import pool from '../db/pool'
import { isAdminEmail } from '../lib/adminEmails'
import { isOwnerEmail } from './requireOwner'

/** 该 email 是否可管理项目/楼书/任务。email 空 → false。白名单查询用 lower(email)。 */
export async function canManageProjects(email: string): Promise<boolean> {
  const e = (email || '').toLowerCase().trim()
  if (!e) return false
  if (isAdminEmail(e) || isOwnerEmail(e)) return true
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM upload_permissions WHERE lower(email) = $1 LIMIT 1`,
      [e]
    )
    return rows.length > 0
  } catch (err) {
    // 查库失败 → fail closed(拒绝),不放行。
    console.error('[requireUploader] whitelist lookup failed:', err)
    return false
  }
}

/**
 * 楼书上传 / 项目增删改 / 任务管理的服务端门。**必须先经过 requireAuth**(拿到 req.user)。
 * 通过 → next();否则 403。
 */
export const requireUploader: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const email = (req.user?.email || req.ctx?.email || '').toLowerCase().trim()
  if (await canManageProjects(email)) return next()
  return res.status(403).json({
    success: false,
    error: '无权管理项目/楼书,请联系管理员开通',
    code: 'uploader_required',
  })
}
