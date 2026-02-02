import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { User, Home, Briefcase, TrendingUp, Users, Baby, MapPin, GraduationCap } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useUserProfile } from '../../contexts/UserProfileContext'
import { UserProfile } from '../../types/comparison'
import { getDefaultProfile } from '../../lib/userProfile'

interface ProfileFormProps {
  onComplete: () => void
}

export function ProfileForm({ onComplete }: ProfileFormProps) {
  const { t } = useTranslation('favorites')
  const { saveProfile, profile } = useUserProfile()

  const defaults = getDefaultProfile()
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    ...defaults,
    ...profile,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveProfile(formData)
    onComplete()
  }

  const updateField = <K extends keyof UserProfile>(field: K, value: UserProfile[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <p className="text-sm text-slate-600">{t('profile.subtitle')}</p>

      {/* Family Status */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4 text-teal-600" />
          {t('profile.familyStatus.label')}
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(['single', 'couple', 'family-small', 'family-large'] as const).map(status => (
            <button
              key={status}
              type="button"
              onClick={() => updateField('familyStatus', status)}
              className={`p-3 text-sm rounded-lg border transition-all ${
                formData.familyStatus === status
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {t(`profile.familyStatus.${status === 'family-small' ? 'familySmall' : status === 'family-large' ? 'familyLarge' : status}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Has Children */}
      {(formData.familyStatus === 'family-small' || formData.familyStatus === 'family-large') && (
        <div className="space-y-3">
          <Label className="flex items-center gap-2 text-sm font-medium">
            <Baby className="h-4 w-4 text-teal-600" />
            {t('profile.children.ages')}
          </Label>
          <Input
            value={formData.childrenAges || ''}
            onChange={e => {
              updateField('childrenAges', e.target.value)
              updateField('hasChildren', true)
            }}
            placeholder="e.g., 3, 7, 12"
            className="focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
      )}

      {/* Purpose */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-sm font-medium">
          {t('profile.purpose.label')}
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {(['investment', 'residence', 'work', 'mixed'] as const).map(purpose => (
            <button
              key={purpose}
              type="button"
              onClick={() => updateField('purpose', purpose)}
              className={`p-3 text-sm rounded-lg border transition-all flex items-center justify-center gap-2 ${
                formData.purpose === purpose
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {purpose === 'investment' && <TrendingUp className="h-4 w-4" />}
              {purpose === 'residence' && <Home className="h-4 w-4" />}
              {purpose === 'work' && <Briefcase className="h-4 w-4" />}
              {purpose === 'mixed' && <User className="h-4 w-4" />}
              {t(`profile.purpose.${purpose}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Investment Options */}
      {(formData.purpose === 'investment' || formData.purpose === 'mixed') && (
        <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
          <div className="space-y-3">
            <Label className="text-sm font-medium">{t('profile.investment.horizon')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['short', 'medium', 'long'] as const).map(horizon => (
                <button
                  key={horizon}
                  type="button"
                  onClick={() => updateField('investmentHorizon', horizon)}
                  className={`p-2 text-xs rounded-lg border transition-all ${
                    formData.investmentHorizon === horizon
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  {t(`profile.investment.${horizon}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">{t('profile.investment.risk')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['conservative', 'moderate', 'aggressive'] as const).map(risk => (
                <button
                  key={risk}
                  type="button"
                  onClick={() => updateField('riskTolerance', risk)}
                  className={`p-2 text-xs rounded-lg border transition-all ${
                    formData.riskTolerance === risk
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  {t(`profile.investment.${risk}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Residence Options */}
      {(formData.purpose === 'residence' || formData.purpose === 'work' || formData.purpose === 'mixed') && (
        <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="h-4 w-4 text-teal-600" />
              {t('profile.workLocation')}
            </Label>
            <Input
              value={formData.workLocation || ''}
              onChange={e => updateField('workLocation', e.target.value)}
              placeholder="e.g., DIFC, Downtown, Marina"
              className="focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.schoolPreference || false}
              onChange={e => updateField('schoolPreference', e.target.checked)}
              className="h-4 w-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
            />
            <span className="flex items-center gap-2 text-sm">
              <GraduationCap className="h-4 w-4 text-slate-500" />
              {t('profile.schoolPreference')}
            </span>
          </label>
        </div>
      )}

      {/* Budget */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">{t('profile.budget.label')}</Label>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-slate-500">Min</Label>
            <Input
              type="number"
              value={formData.budget?.min || 500000}
              onChange={e => updateField('budget', {
                ...formData.budget,
                min: parseInt(e.target.value) || 0,
                max: formData.budget?.max || 5000000,
              })}
              className="focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Max</Label>
            <Input
              type="number"
              value={formData.budget?.max || 5000000}
              onChange={e => updateField('budget', {
                ...formData.budget,
                min: formData.budget?.min || 500000,
                max: parseInt(e.target.value) || 0,
              })}
              className="focus:ring-teal-500 focus:border-teal-500"
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          AED {(formData.budget?.min || 500000).toLocaleString()} - AED {(formData.budget?.max || 5000000).toLocaleString()}
        </p>
      </div>

      {/* Submit */}
      <Button
        type="submit"
        className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600"
      >
        {t('profile.save')}
      </Button>
    </form>
  )
}
