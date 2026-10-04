export function containsCjk(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}
