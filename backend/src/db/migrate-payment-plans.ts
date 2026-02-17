/**
 * Migration: Move payment plans from separate table to JSONB column
 *
 * Run with: npx ts-node src/db/migrate-payment-plans.ts
 */

import pool from './pool'

async function migratePaymentPlans() {
  const client = await pool.connect()

  try {
    console.log('🚀 Starting payment plans migration...\n')

    await client.query('BEGIN')

    // Step 1: Add payment_plan JSONB column if not exists
    console.log('1️⃣ Adding payment_plan JSONB column...')
    await client.query(`
      ALTER TABLE residential_projects
      ADD COLUMN IF NOT EXISTS payment_plan JSONB DEFAULT '[]'::jsonb
    `)
    console.log('   ✅ Column added\n')

    // Step 2: Check if project_payment_plans table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'project_payment_plans'
      )
    `)

    if (!tableCheck.rows[0].exists) {
      console.log('ℹ️ project_payment_plans table does not exist, skipping data migration\n')
    } else {
      // Step 3: Migrate existing data
      console.log('2️⃣ Migrating existing payment plan data...')

      const migrateResult = await client.query(`
        UPDATE residential_projects rp
        SET payment_plan = COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'milestone', ppp.milestone_name,
                'percentage', ppp.percentage,
                'date', ppp.milestone_date,
                'intervalMonths', ppp.interval_months,
                'intervalDescription', ppp.interval_description,
                'description', ppp.description,
                'displayOrder', ppp.display_order
              )
              ORDER BY ppp.display_order
            )
            FROM project_payment_plans ppp
            WHERE ppp.project_id = rp.id
          ),
          '[]'::jsonb
        )
        WHERE EXISTS (
          SELECT 1 FROM project_payment_plans WHERE project_id = rp.id
        )
        RETURNING rp.id, rp.project_name
      `)

      console.log(`   ✅ Migrated ${migrateResult.rowCount} projects\n`)

      // Step 4: Verify migration
      console.log('3️⃣ Verifying migration...')
      const verifyResult = await client.query(`
        SELECT
          rp.id,
          rp.project_name,
          jsonb_array_length(rp.payment_plan) as milestone_count,
          (SELECT COUNT(*) FROM project_payment_plans WHERE project_id = rp.id) as old_count
        FROM residential_projects rp
        WHERE jsonb_array_length(rp.payment_plan) > 0
        ORDER BY rp.project_name
      `)

      if (verifyResult.rows.length > 0) {
        console.log('   Projects with payment plans:')
        for (const row of verifyResult.rows) {
          const match = row.milestone_count === parseInt(row.old_count) ? '✅' : '❌'
          console.log(`   ${match} ${row.project_name}: ${row.milestone_count} milestones`)
        }
      }
      console.log()

      // Step 5: Drop the old table
      console.log('4️⃣ Dropping project_payment_plans table...')
      await client.query('DROP TABLE IF EXISTS project_payment_plans CASCADE')
      console.log('   ✅ Table dropped\n')
    }

    // Step 6: Update views that reference the old table
    console.log('5️⃣ Updating database views...')

    // Drop old view
    await client.query('DROP VIEW IF EXISTS residential_projects_with_details CASCADE')

    // Create updated view without payment plan join (it's now in the main table)
    await client.query(`
      CREATE OR REPLACE VIEW residential_projects_with_details AS
      SELECT
          rp.*,
          COUNT(DISTINCT put.id) as unit_type_count,
          COALESCE(SUM(put.unit_count), 0) as total_unit_count,
          COALESCE(
              jsonb_agg(
                  jsonb_build_object(
                      'id', put.id,
                      'name', put.unit_type_name,
                      'bedrooms', put.bedrooms,
                      'bathrooms', put.bathrooms,
                      'area', put.area,
                      'price', put.price,
                      'floor_plan_image', put.floor_plan_image
                  ) ORDER BY put.bedrooms, put.area
              ) FILTER (WHERE put.id IS NOT NULL),
              '[]'::jsonb
          ) as unit_types
      FROM residential_projects rp
      LEFT JOIN project_unit_types put ON rp.id = put.project_id
      GROUP BY rp.id
    `)
    console.log('   ✅ Views updated\n')

    // Step 7: Update get_project_details function
    console.log('6️⃣ Updating get_project_details function...')
    await client.query(`
      CREATE OR REPLACE FUNCTION get_project_details(project_uuid UUID)
      RETURNS JSON AS $$
      DECLARE
          result JSON;
      BEGIN
          SELECT json_build_object(
              'project', row_to_json(rp.*),
              'unitTypes', COALESCE(
                  (SELECT json_agg(row_to_json(put.*) ORDER BY put.bedrooms, put.area)
                   FROM project_unit_types put WHERE put.project_id = project_uuid),
                  '[]'::json
              ),
              'paymentPlan', COALESCE(rp.payment_plan, '[]'::jsonb)
          ) INTO result
          FROM residential_projects rp
          WHERE rp.id = project_uuid;

          RETURN result;
      END;
      $$ language 'plpgsql'
    `)
    console.log('   ✅ Function updated\n')

    await client.query('COMMIT')

    console.log('🎉 Migration completed successfully!')
    console.log('\nNext steps:')
    console.log('1. Update residential-projects.ts route to use payment_plan JSONB')
    console.log('2. Update compare.ts route to use payment_plan JSONB')
    console.log('3. Remove project_payment_plans references from schema file')

  } catch (error) {
    await client.query('ROLLBACK')
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

migratePaymentPlans()
