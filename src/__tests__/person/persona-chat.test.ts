import { describe, it, expect } from 'vitest';
import { isBoundaryRequest } from '@/lib/person/persona-chat';

describe('isBoundaryRequest (V3/T-V3-5)', () => {
  it('flags voice-clone / avatar / impersonation requests', () => {
    expect(isBoundaryRequest('用他的声音克隆一段')).toBe(true);
    expect(isBoundaryRequest('please clone the voice of this person')).toBe(true);
    expect(isBoundaryRequest('生成一个视频头像')).toBe(true);
    expect(isBoundaryRequest('冒充本人发一条声明')).toBe(true);
  });

  it('flags abusive / misrepresenting requests', () => {
    expect(isBoundaryRequest('用本人语气骂一下对手')).toBe(true);
    expect(isBoundaryRequest('insult his rival in his style')).toBe(true);
  });

  it('passes through normal grounded questions', () => {
    expect(isBoundaryRequest('他对远程工作的看法是什么')).toBe(false);
    expect(isBoundaryRequest('What did she think about AI safety')).toBe(false);
  });
});
