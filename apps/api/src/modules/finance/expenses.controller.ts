import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import {
  AllocateExpensePaymentDto,
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  ListExpenseCategoriesQueryDto,
  ListExpensesQueryDto,
  PayExpenseNowDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensesService } from './expenses.service';

@ApiTags('finance-expense-categories')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_READ)
  @ApiOperation({ summary: 'List expense categories' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListExpenseCategoriesQueryDto,
  ) {
    return this.categories.list(company, query);
  }

  @Get(':categoryId')
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_READ)
  @ApiOperation({ summary: 'Get expense category' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return { data: await this.categories.get(company, categoryId) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Create expense category' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateExpenseCategoryDto,
  ) {
    return { data: await this.categories.create(company, body) };
  }

  @Patch(':categoryId')
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Update expense category' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: UpdateExpenseCategoryDto,
  ) {
    return { data: await this.categories.update(company, categoryId, body) };
  }

  @Post(':categoryId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Archive expense category' })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return { data: await this.categories.archive(company, categoryId) };
  }
}

@ApiTags('finance-expenses')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_READ)
  @ApiOperation({ summary: 'List expenses' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.expenses.list(company, query);
  }

  @Get(':expenseId')
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_READ)
  @ApiOperation({ summary: 'Get expense detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return { data: await this.expenses.get(company, expenseId) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({
    summary: 'Create expense (approve does not post AccountMovement)',
  })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateExpenseDto) {
    return { data: await this.expenses.create(company, body) };
  }

  @Patch(':expenseId')
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Update DRAFT expense' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body() body: UpdateExpenseDto,
  ) {
    return { data: await this.expenses.update(company, expenseId, body) };
  }

  @Post(':expenseId/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Approve DRAFT expense (no AccountMovement)' })
  async approve(
    @CurrentCompany() company: CompanyContext,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return { data: await this.expenses.approve(company, expenseId) };
  }

  @Post(':expenseId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Cancel unpaid expense' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return { data: await this.expenses.cancel(company, expenseId) };
  }

  @Post(':expenseId/allocate-payment')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({
    summary: 'Allocate a POSTED Payment to an APPROVED Expense (same currency only)',
  })
  async allocatePayment(
    @CurrentCompany() company: CompanyContext,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body() body: AllocateExpensePaymentDto,
  ) {
    return { data: await this.expenses.allocatePayment(company, expenseId, body) };
  }

  @Post(':expenseId/pay-now')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_EXPENSES_MANAGE)
  @ApiOperation({
    summary: 'Approve if needed, create+post Payment, allocate (atomic docs; same currency)',
  })
  async payNow(
    @CurrentCompany() company: CompanyContext,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body() body: PayExpenseNowDto,
  ) {
    return { data: await this.expenses.payNow(company, expenseId, body) };
  }
}
