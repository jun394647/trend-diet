import { buildIndex, type FoodDbFile, type IndexedFood } from './foodSearch'

export interface FoodDb {
  source: string
  updated: string
  index: IndexedFood[]
}

let cache: Promise<FoodDb> | null = null

/** 내장 음식 DB를 한 번만 내려받아 색인한다. 실패하면 다음 호출에서 다시 시도한다. */
export function loadFoodDb(): Promise<FoodDb> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}food-db.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`food-db ${res.status}`)
        return res.json() as Promise<FoodDbFile>
      })
      .then((file) => ({ source: file.source, updated: file.updated, index: buildIndex(file.items) }))
      .catch((e) => {
        cache = null
        throw e
      })
  }
  return cache
}
