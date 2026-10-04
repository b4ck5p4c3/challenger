import styles from './components.module.css'

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`${props.className} ${styles.button}`}></button>
}