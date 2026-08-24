/**
 * 「可管理项目」权限 —— 单一真相源,服务端强制。
 *
 * 谁能上传楼书 / 增删改项目 / 管理任务,由这四条决定(任一即可):
 *   1. isAdminEmail  —— admin 白名单(owner + Shell),见 lib/adminEmails.ts
 *   2. isOwnerEmail  —— owner 白名单,见 middleware/requireOwner.ts
 *   3. upload_permissions 表白名单 —— 人工 grant 的账号
 *   4. role='developer' + 生效中的订阅 —— 开发商套餐含「上传楼书」
 *
 * ⚠️ 第 4 条**必须保留**(2026-07-16 核实):本函数与 /api/agents/can-upload 的
 * canUpload 是**同一个门的两侧**(前端 gate + 服务端 enforce),判据必须一致,
 * 否则前端放行、后端 403,用户看到按钮点了就报错。
 * 实测:role='developer' 有 16 人、且**全部**不在 upload_permissions(白名单只有 1 人)。
 * 去掉这条 = 当场锁死 16 个试用中的开发商。要改成"付费方也走人工 grant",
 * 得先把这 16 人迁进 upload_permissions,不能直接删判据。
 */
import { Request, Response, NextFunction, RequestHandler } from 'express'
import pool from '../db/pool'
import { isAdminEmail } from '../lib/adminEmails'
import { isOwnerEmail } from './requireOwner'
import { ENTITLED_SQL } from '../lib/subscriptionStatus'

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
    if (rows.length > 0) return true
    // 开发商套餐含「上传楼书」:role=developer + active/trialing 订阅。
    // (免绑卡试用过期后没有 webhook 关它,sweep 有 5min 窗口 → 这里带即时过期判断。)
    const dev = await pool.query(
      `SELECT 1
         FROM user_profiles up
         JOIN lt_agents la ON lower(la.email) = $1
         JOIN lt_subscriptions s
           ON s.agent_id = COALESCE(la.billing_agent_id, la.id)
          AND s.status IN ${ENTITLED_SQL}
          AND (s.source <> 'free_trial' OR s.current_period_end > now())
        WHERE lower(up.email) = $1 AND up.role = 'developer'
        LIMIT 1`,
      [e]
    )
    return dev.rows.length > 0
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
