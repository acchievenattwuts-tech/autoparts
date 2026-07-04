import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  verifyMessengerSignature,
  verifyMessengerSubscription,
} from "@/lib/messenger/messenger-config";

describe("verifyMessengerSubscription", () => {
  it("echoes the challenge on a valid handshake", () => {
    const result = verifyMessengerSubscription({
      mode: "subscribe",
      token: "secret-token",
      challenge: "1234",
      verifyToken: "secret-token",
    });
    assert.equal(result, "1234");
  });

  it("rejects a wrong token", () => {
    const result = verifyMessengerSubscription({
      mode: "subscribe",
      token: "wrong",
      challenge: "1234",
      verifyToken: "secret-token",
    });
    assert.equal(result, null);
  });

  it("rejects when verifyToken is unset", () => {
    const result = verifyMessengerSubscription({
      mode: "subscribe",
      token: "anything",
      challenge: "1234",
      verifyToken: null,
    });
    assert.equal(result, null);
  });
});

describe("verifyMessengerSignature", () => {
  const appSecret = "app-secret";
  const rawBody = JSON.stringify({ object: "page", entry: [] });
  const validSig = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  it("accepts a correct signature", () => {
    assert.equal(
      verifyMessengerSignature({ appSecret, rawBody, signatureHeader: validSig }),
      true,
    );
  });

  it("rejects a tampered body", () => {
    assert.equal(
      verifyMessengerSignature({ appSecret, rawBody: rawBody + " ", signatureHeader: validSig }),
      false,
    );
  });

  it("rejects a missing header", () => {
    assert.equal(
      verifyMessengerSignature({ appSecret, rawBody, signatureHeader: null }),
      false,
    );
  });

  it("rejects when app secret is unset", () => {
    assert.equal(
      verifyMessengerSignature({ appSecret: null, rawBody, signatureHeader: validSig }),
      false,
    );
  });

  it("rejects a non-sha256 algo prefix", () => {
    assert.equal(
      verifyMessengerSignature({ appSecret, rawBody, signatureHeader: "sha1=deadbeef" }),
      false,
    );
  });
});
