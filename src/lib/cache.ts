const entries=new Map<string,{expires:number,value:unknown}>();
export function cacheGet<T>(key:string){const item=entries.get(key);if(!item||item.expires<Date.now()){entries.delete(key);return null}return item.value as T}
export function cacheSet<T>(key:string,value:T,ttl=60_000){entries.set(key,{value,expires:Date.now()+ttl})}
export function cacheInvalidate(prefix:string){for(const key of entries.keys())if(key.startsWith(prefix))entries.delete(key)}
