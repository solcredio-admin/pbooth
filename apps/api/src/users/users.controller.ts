import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { UsersService, createUserSchema, updateUserSchema } from "./users.service.js";
import type { Req as Request } from "../common/request.js";

const id = { schema: z.string().uuid("Not a valid user id") };

// OWNER-only (no @Allow): managing who can sign in.
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() { return this.users.list(); }

  @Post()
  create(@Body({ schema: createUserSchema }) body: z.infer<typeof createUserSchema>, @Req() r: Request) {
    return this.users.create(body, r.admin!, r.ip);
  }

  @Patch(":id")
  update(@Param("id", id) userId: string, @Body({ schema: updateUserSchema }) body: z.infer<typeof updateUserSchema>, @Req() r: Request) {
    return this.users.update(userId, body, r.admin!, r.ip);
  }

  @Delete(":id")
  remove(@Param("id", id) userId: string, @Req() r: Request) {
    return this.users.remove(userId, r.admin!, r.ip);
  }
}
