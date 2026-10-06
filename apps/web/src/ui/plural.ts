/** "1 layout", "3 layouts" (or the plural you give: "2 people"). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
