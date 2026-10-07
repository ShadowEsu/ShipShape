import { useStripe } from "@stripe/stripe-react-native";

// Sells "SnapStudy Pro", a digital subscription, with a card form.
export function useUpgrade() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  return { initPaymentSheet, presentPaymentSheet };
}
