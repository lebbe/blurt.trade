export type Blurt = {
  id: number
  username: string
  text: string
  createdAt: Date
}

export type User = {
  id: number
  username: string
  passwordHash: string
}

export const blurts: Blurt[] = []
export const users: User[] = []

let nextId = 1
let nextUserId = 1

export function addBlurt(username: string, text: string): void {
  blurts.push({ id: nextId++, username, text, createdAt: new Date() })
}

export function addUser(username: string, passwordHash: string): User {
  const user = { id: nextUserId++, username, passwordHash }
  users.push(user)
  return user
}
