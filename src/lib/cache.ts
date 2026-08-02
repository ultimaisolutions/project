const entries=new Map<string,{expires:number,value:unknown}>();
/** Returns a live cached value, evicting expired entries and returning `null` on a miss. */
export function cacheGet<T>(key:string){const item=entries.get(key);if(!item||item.expires<Date.now()){entries.delete(key);return null}return item.value as T}
/** Stores a value in the process-local cache for the specified TTL in milliseconds. */
export function cacheSet<T>(key:string,value:T,ttl=60_000){entries.set(key,{value,expires:Date.now()+ttl})}
/** Removes every process-local cache entry whose key starts with the supplied prefix. */
export function cacheInvalidate(prefix:string){for(const key of entries.keys())if(key.startsWith(prefix))entries.delete(key)}
