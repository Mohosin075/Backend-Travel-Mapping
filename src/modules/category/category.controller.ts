import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import catchAsync from '../../shared/catchAsync'
import sendResponse from '../../shared/sendResponse'
import { CategoryService } from './category.service'
import { localizeDocument } from '../../helpers/localize'

const createCategory = catchAsync(async (req: Request, res: Response) => {
  const categoryData = { ...req.body }

  // Backward compatibility: support existing "images" field.
  if (req.body.images) {
    categoryData.icon = Array.isArray(req.body.images)
      ? req.body.images[0]
      : req.body.images
  }
  if (req.body.icon) {
    categoryData.icon = Array.isArray(req.body.icon)
      ? req.body.icon[0]
      : req.body.icon
  }

  const result = await CategoryService.createCategory(categoryData)
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Category created successfully',
    data: localizeDocument(result, req.lang, ['name']),
  })
})

const getAllCategories = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryService.getAllCategories(req.query)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Categories retrieved successfully',
    meta: result.meta,
    data: localizeDocument(result.data, req.lang, ['name']),
  })
})

const getCategoryById = catchAsync(async (req: Request, res: Response) => {
  const id = (req.params && (req.params as any).id) || (req.query && (req.query as any).id) || (req.body && (req.body as any).id)
  if (!id) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: 'Category id is required in URL params, query or request body',
    })
  }
  const result = await CategoryService.getCategoryById(id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Category retrieved successfully',
    data: localizeDocument(result, req.lang, ['name']),
  })
})

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const id = (req.params && (req.params as any).id) || (req.body && (req.body as any).id)
  if (!id) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: 'Category id is required in URL params or request body',
    })
  }
  const categoryData = { ...req.body }

  // Backward compatibility: support existing "images" field.
  if (req.body.images) {
    categoryData.icon = Array.isArray(req.body.images)
      ? req.body.images[0]
      : req.body.images
  }
  if (req.body.icon) {
    categoryData.icon = Array.isArray(req.body.icon)
      ? req.body.icon[0]
      : req.body.icon
  }

  const result = await CategoryService.updateCategory(id, categoryData)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Category updated successfully',
    data: localizeDocument(result, req.lang, ['name']),
  })
})

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  const id = (req.params && (req.params as any).id) || (req.body && (req.body as any).id)
  if (!id) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: 'Category id is required in URL params or request body',
    })
  }
  const result = await CategoryService.deleteCategory(id)
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Category deleted successfully',
    data: localizeDocument(result, req.lang, ['name']),
  })
})

export const CategoryController = {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
}
