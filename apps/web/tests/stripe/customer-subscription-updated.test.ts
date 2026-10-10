import type Stripe from "stripe";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { customerSubscriptionUpdated } from "../../app/(ee)/api/stripe/webhook/customer-subscription-updated";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  retrieve: vi.fn(),
  updateWorkspacePlan: vi.fn(),
  sendCancellationFeedback: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    subscriptions: {
      retrieve: mocks.retrieve,
    },
  },
}));

vi.mock(
  "../../app/(ee)/api/stripe/webhook/utils/update-workspace-plan",
  () => ({
    updateWorkspacePlan: mocks.updateWorkspacePlan,
  }),
);

vi.mock(
  "../../app/(ee)/api/stripe/webhook/utils/send-cancellation-feedback",
  () => ({
    sendCancellationFeedback: mocks.sendCancellationFeedback,
  }),
);

function subscription({
  priceId,
  status = "active",
}: {
  priceId: string;
  status?: Stripe.Subscription.Status;
}) {
  return {
    id: "sub_test",
    customer: "cus_test",
    status,
    cancel_at_period_end: false,
    items: {
      data: [{ price: { id: priceId } }],
    },
  } as unknown as Stripe.Subscription;
}

function event(payload: Stripe.Subscription) {
  return {
    data: { object: payload },
  } as unknown as Stripe.CustomerSubscriptionUpdatedEvent;
}

const workspace = {
  id: "ws_test",
  slug: "acme",
  users: [],
  restrictedTokens: [],
};

describe("customerSubscriptionUpdated", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset().mockResolvedValue(workspace);
    mocks.retrieve.mockReset();
    mocks.updateWorkspacePlan.mockReset();
    mocks.sendCancellationFeedback.mockReset();
  });

  test("uses the latest subscription from Stripe instead of a stale event payload", async () => {
    const latest = subscription({ priceId: "price_new" });
    mocks.retrieve.mockResolvedValue(latest);

    await customerSubscriptionUpdated(
      event(subscription({ priceId: "price_old" })),
    );

    expect(mocks.retrieve).toHaveBeenCalledWith("sub_test");
    expect(mocks.updateWorkspacePlan).toHaveBeenCalledWith({
      workspace,
      priceId: "price_new",
      subscription: latest,
    });
  });

  test("skips a late event for a subscription that has since been canceled", async () => {
    mocks.retrieve.mockResolvedValue(
      subscription({ priceId: "price_old", status: "canceled" }),
    );

    const result = await customerSubscriptionUpdated(
      event(subscription({ priceId: "price_old" })),
    );

    expect(result).toContain("skipping");
    expect(mocks.updateWorkspacePlan).not.toHaveBeenCalled();
  });
});
