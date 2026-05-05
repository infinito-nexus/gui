"use client";

import styles from "../../../DeploymentWorkspace.module.css";
import type { Role } from "../../types";

export type OrderItem = {
  alias: string;
  role: Role | undefined;
  roleId: string;
  plan: string | null;
  amount: string | null;
  currency: string | null;
};

type Props = {
  items: OrderItem[];
};

export default function OrderItemsTable({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className={`text-body-secondary ${styles.orderTabEmpty}`}>
        Your cart is empty. Add apps from the Software tab and assign them to
        a server in the Hardware tab; they will show up here.
      </p>
    );
  }
  return (
    <table className={styles.orderTabItems}>
      <thead>
        <tr>
          <th>Server</th>
          <th>App</th>
          <th>Plan</th>
          <th className={styles.orderTabPriceCol}>Price</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => (
          <tr key={`${item.alias}-${item.roleId}-${idx}`}>
            <td>{item.alias}</td>
            <td>{item.role?.display_name || item.roleId}</td>
            <td>{item.plan || "—"}</td>
            <td className={styles.orderTabPriceCol}>
              {item.amount ? `${item.amount} ${item.currency || ""}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
