import { describe, expect, spyOn, test } from "bun:test"

import { attempt, err } from "../index.ts"
import { db, example, fakeLogger } from "./example.ts"

class CustomError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "CustomError"
  }
}

const throwsError = () => {
  throw new Error("sync error")
}

const throwsString = () => {
  throw "string error"
}

describe("attempt", () => {
  test("handles successful synchronous operations", () => {
    const [value, error] = attempt(() => "success")

    expect(value).toBe("success")
    expect(error).toBeUndefined()
  })

  test("handles failed synchronous operations", () => {
    const [value, error] = attempt(() => {
      throwsError()
    })

    expect(value).toBeUndefined()
    expect(error).toBeInstanceOf(Error)
    expect(error?.fmtErr()).toBe("sync error")
  })

  test("handles successful async operations", async () => {
    const [value, error] = await attempt(async () => "async success")

    expect(value).toBe("async success")
    expect(error).toBeUndefined()
  })

  test("handles failed async operations", async () => {
    const [value, error] = await attempt(async () => {
      throw new Error("async error")
    })

    expect(value).toBeUndefined()
    expect(error).toBeInstanceOf(Error)
    expect(error?.fmtErr()).toBe("async error")
  })

  test("handles non-Error throws", () => {
    const [value, error] = attempt(() => {
      throwsString()
    })

    expect(value).toBeUndefined()
    expect(error).toBeInstanceOf(Error)
    expect(error?.fmtErr()).toBe("string error")
  })
})

describe("CtxError", () => {
  describe("fmtErr", () => {
    test("formats basic error message", () => {
      const error = err("Base message")

      expect(error.fmtErr()).toBe("Base message")
    })

    test("prepends message if provided", () => {
      const error = err("Base message")

      expect(error.fmtErr("prepend message")).toBe("prepend message -> Base message")
    })

    test("formats error with cause", () => {
      const cause = new Error("Cause message")
      const error = err("Base message", cause)

      expect(error.fmtErr()).toBe("Base message -> Cause message")
    })

    test("formats error with nested causes", () => {
      const deepCause = new Error("Deep cause")
      const middleCause = new Error("Middle cause", { cause: deepCause })
      const error = err("Base message", middleCause)

      expect(error.fmtErr()).toBe("Base message -> Middle cause -> Deep cause")
    })

    test("handles non-Error causes", () => {
      const error = err("Base message", "string cause")

      expect(error.fmtErr()).toBe("Base message -> string cause")
    })

    test("includes custom error names in message and excludes Error and CtxError prefixes", () => {
      const regularError = new Error("Error message")
      const ctxError = err("CtxError message")
      const customError = new CustomError("CustomError message")

      const error1 = err("Base message", regularError)
      const error2 = err("Base message", ctxError)
      const error3 = err("Base message", customError)

      expect(error1.fmtErr()).toBe("Base message -> Error message")
      expect(error2.fmtErr()).toBe("Base message -> CtxError message")
      expect(error3.fmtErr()).toBe("Base message -> CustomError: CustomError message")
    })

    test("handles falsy cause", () => {
      const error = err("Base message", "")

      expect(error.fmtErr()).toBe("Base message")
    })

    test("excludes blank error messages", () => {
      // eslint-disable-next-line unicorn/error-message
      const blankError = new Error("")
      const error = err("Base message", blankError)

      expect(error.fmtErr("")).toBe("Base message")
    })

    test("shows 'Unknown error' when all messages are blank", () => {
      // eslint-disable-next-line unicorn/error-message
      const blankError = new Error("")
      const error = err("", blankError)

      expect(error.fmtErr()).toBe("Unknown error")
    })
  })

  describe("ctx", () => {
    test("adds context to error", () => {
      const error = err("Base message").ctx({ foo: "bar" })

      expect(error.context).toEqual({ foo: "bar" })
    })

    test("merges multiple contexts", () => {
      const error = err("Base message").ctx({ foo: "bar" }).ctx({ baz: "qux" })

      expect(error.context).toEqual({ foo: "bar", baz: "qux" })
    })
  })

  describe("get", () => {
    test("retrieves context value", () => {
      const error = err("Base message").ctx({ foo: "bar" })

      expect(error.get<string>("foo")).toBe("bar")
    })

    test("returns undefined for non-existent key", () => {
      const error = err("Base message").ctx({ foo: "bar" })

      expect(error.get<string>("nonexistent")).toBeUndefined()
    })

    test("retrieves falsy values correctly", () => {
      const error = err("Base message").ctx({
        zero: 0,
        empty: "",
        falseValue: false,
        // eslint-disable-next-line unicorn/no-null
        nullValue: null,
        undefinedValue: undefined,
      })

      expect(error.get<number>("zero")).toBe(0)
      expect(error.get<string>("empty")).toBe("")
      expect(error.get<boolean>("falseValue")).toBe(false)
      // eslint-disable-next-line unicorn/no-null
      expect(error.get<null>("nullValue")).toBe(null)
      // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
      expect(error.get<undefined>("undefinedValue")).toBeUndefined()
    })

    test("retrieves value from cause chain", () => {
      const deepError = err("Deep error").ctx({ deepKey: "foo" })
      const middleError = err("Middle error", deepError).ctx({ middleKey: "bar" })
      const topError = err("Top error", middleError).ctx({ topKey: "baz" })

      expect(topError.get<string>("deepKey")).toBe("foo")
      expect(topError.get<string>("middleKey")).toBe("bar")
      expect(topError.get<string>("topKey")).toBe("baz")
    })

    test("retrieves deepest context value", () => {
      const deepError = err("Deep error").ctx({ deepKey: "foo", shared: "deep" })
      const middleError = err("Middle error", deepError).ctx({ middleKey: "bar", shared: "middle" })
      const topError = err("Top error", middleError).ctx({ topKey: "baz", shared: "top" })

      expect(topError.get<string>("shared")).toBe("deep")
    })
  })
})

describe("integration", () => {
  test("attempt and err work together", async () => {
    const [, error] = await attempt(async () => {
      throw new Error("Original error")
    })
    const formattedError = err("Operation failed", error)

    expect(formattedError.fmtErr()).toBe("Operation failed -> Original error")
  })

  test("handles nested error chains", async () => {
    const deepError = new Error("Deep error")
    const middleError = new Error("Middle error", { cause: deepError })

    const [, error] = await attempt(async () => {
      throw middleError
    })

    const formattedError = err("Top error", error)

    expect(formattedError.fmtErr()).toBe("Top error -> Middle error -> Deep error")
  })

  test("complete example", async () => {
    const connectSpy = spyOn(db, "connect").mockImplementation(() => {
      throw new Error("invalid dbId")
    })

    const [connectResult, connectError] = await example()
    if (!connectError) throw new Error("connectError should be defined")

    const errorMessage = connectError.fmtErr("something went wrong")

    expect(connectResult).toBeUndefined()
    expect(fakeLogger.error(errorMessage, connectError)).toBe(
      "2025-02-28T16:51:01.378Z [db-connect] something went wrong -> failed to get meetings -> failed to connect to database -> invalid dbId",
    )

    connectSpy.mockRestore()

    const querySpy = spyOn(db, "query").mockImplementation(() => {
      throw new Error("invalid query")
    })

    const [queryResult, queryError] = await example()
    if (!queryError) throw new Error("queryError should be defined")

    const errorMessage2 = queryError.fmtErr("something went wrong")

    expect(queryResult).toBeUndefined()
    expect(fakeLogger.error(errorMessage2, queryError)).toBe(
      "[db-query] something went wrong -> failed to get meetings -> failed to query db -> invalid query: for 'SELECT * FROM meetings WHERE scheduled_time < actual_end_time'",
    )

    querySpy.mockRestore()
  })
})
