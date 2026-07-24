/**
 * V2/T-V2-3 (L3): entity arbitration prompt.
 *
 * Last-resort resolver tier: when exact-name and embedding-similarity both fail
 * to confidently map a candidate to an existing entity, ask a cheap model in a
 * single batched call whether the candidate is "the same as" any known entity of
 * the same type. Output is a strict { candIdx, matchedEntityId | null } array so
 * it is safe to parse with completeStructured.
 */

export const ENTITY_RESOLUTION_PROMPT = `判断下面这个候选实体是否与已知实体列表中的某一个指向同一个对象（同类型 {{type}}）。

要求：
- 只有当指向现实世界同一对象时才匹配（例如 "OpenAI" 与 "Open AI" 是同一个；"苹果公司" 与 "Apple Inc." 是同一个）。
- 名称相似但指向不同对象则不匹配（例如两个同名的人、两家不同的公司）。
- 无法确定时返回 null，宁可新建实体也不要错误合并。

候选实体：{{candidate}}

已知实体列表（JSON）：{{existing}}

输出 JSON：
{
  "pairs": [
    { "candIdx": 0, "matchedEntityId": "已匹配的实体 id 或 null" }
  ]
}
`;
