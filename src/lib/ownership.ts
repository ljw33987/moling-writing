import { db } from '@/lib/db'

export async function getOwnedNovel(userId: string, novelId: string) {
  return db.novel.findFirst({
    where: { id: novelId, userId, deleted: false },
    select: { id: true },
  })
}

export async function getOwnedChapter(userId: string, chapterId: string) {
  return db.chapter.findFirst({
    where: { id: chapterId, novel: { userId, deleted: false } },
    select: { id: true, novelId: true, volumeId: true },
  })
}

export async function getOwnedVolume(userId: string, volumeId: string) {
  return db.volume.findFirst({
    where: { id: volumeId, novel: { userId, deleted: false } },
    select: { id: true, novelId: true },
  })
}

export async function getOwnedFolder(userId: string, folderId: string) {
  return db.folder.findFirst({ where: { id: folderId, userId }, select: { id: true } })
}
