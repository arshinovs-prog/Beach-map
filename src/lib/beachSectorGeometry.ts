import type { Feature, Polygon } from 'geojson'
import { supabase } from './supabase'
import { ensureAnonymousSession } from './anonymousAuth'

export type SavedSector = {
  id: number
  name: string
  access_name: string | null
  latitude: number
  longitude: number
  is_active: boolean
  geometry: unknown
}

export async function isBeachMapAdmin(): Promise<boolean> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return false
  const { data, error } = await supabase.rpc('beach_map_is_admin')
  if (error) throw error
  return data === true
}

export async function saveBeachSector(input: {
  id: number | null
  name: string
  accessName?: string | null
  polygon: Feature<Polygon> | Polygon
}): Promise<number> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Сначала войдите в аккаунт администратора')

  const geometry = 'geometry' in input.polygon ? input.polygon.geometry : input.polygon
  if (geometry.type !== 'Polygon') throw new Error('Ожидается Polygon')

  const { data, error } = await supabase.rpc('admin_save_beach_sector', {
    p_sector_id: input.id,
    p_name: input.name,
    p_access_name: input.accessName ?? null,
    p_geojson: geometry,
  })
  if (error) throw error
  return Number(data)
}

export async function loadActiveSectorGeometries(): Promise<SavedSector[]> {
  const { data, error } = await supabase
    .from('beach_sectors')
    .select('id,name,access_name,latitude,longitude,is_active,geometry')
    .eq('is_active', true)
    .not('geometry', 'is', null)
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as SavedSector[]
}

export async function deactivateBeachSector(sectorId: number): Promise<void> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('Сначала войдите в аккаунт администратора')
  const { error } = await supabase.rpc('admin_deactivate_beach_sector', {
    p_sector_id: sectorId,
  })
  if (error) throw error
}

export async function signInBeachMapAdmin(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!(await isBeachMapAdmin())) {
    await supabase.auth.signOut()
    await ensureAnonymousSession()
    throw new Error('Этот аккаунт не имеет прав администратора')
  }
}

export async function signOutBeachMapAdmin(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
  await ensureAnonymousSession()
}
