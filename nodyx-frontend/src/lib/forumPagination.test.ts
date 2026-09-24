import { describe, it, expect } from 'vitest'
import { POSTS_PER_PAGE, totalPages, parsePageParam, pageItems } from './forumPagination'

describe('forumPagination', () => {
	it('totalPages arrondit au-dessus et vaut au moins 1', () => {
		expect(totalPages(0)).toBe(1)
		expect(totalPages(null)).toBe(1)
		expect(totalPages(POSTS_PER_PAGE)).toBe(1)
		expect(totalPages(POSTS_PER_PAGE + 1)).toBe(2)
		expect(totalPages(POSTS_PER_PAGE * 10)).toBe(10)
	})

	it('parsePageParam tolère les valeurs invalides', () => {
		expect(parsePageParam(null)).toBe(1)
		expect(parsePageParam('abc')).toBe(1)
		expect(parsePageParam('0')).toBe(1)
		expect(parsePageParam('-3')).toBe(1)
		expect(parsePageParam('4')).toBe(4)
		expect(parsePageParam('last')).toBe('last')
	})

	it('pageItems garde les bouts et comble les trous avec …', () => {
		expect(pageItems(1, 1)).toEqual([1])
		expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5])
		expect(pageItems(1, 20)).toEqual([1, 2, 3, '…', 20])
		expect(pageItems(10, 20)).toEqual([1, '…', 8, 9, 10, 11, 12, '…', 20])
		expect(pageItems(20, 20)).toEqual([1, '…', 18, 19, 20])
	})
})
